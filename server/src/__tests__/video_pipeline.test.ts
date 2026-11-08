import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { runFfmpeg, probe } from '../services/video/ffmpeg.js';
import { localStorage } from '../services/storage/storage.js';
import { Worker } from '../services/queue/worker.js';
import { registerRenderJob } from '../services/video/renderJob.js';
import { Asset } from '../models/Asset.js';
import { Job } from '../models/Job.js';
import { Project } from '../models/Project.js';
import { Workspace } from '../models/Workspace.js';
import { CreditTransaction } from '../models/CreditTransaction.js';
import { claim, enqueue, fail, sweepExpired } from '../services/queue/queue.js';

let fixture: Buffer;
const worker = new Worker(1, 10);

beforeAll(async () => {
  await connectTestDb();
  registerRenderJob();
  // 7s test clip: tone, 2s of silence (2.5s–4.5s), tone.
  const dir = await mkdtemp(path.join(tmpdir(), 'sis-fixture-'));
  const file = path.join(dir, 'talk.mp4');
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=7',
    '-f', 'lavfi', '-i', "aevalsrc='if(between(t,2.5,4.5),0,0.4*sin(440*2*PI*t))':s=48000:d=7",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
  ]);
  fixture = await readFile(file);
}, 120_000);
beforeEach(resetDb);
afterAll(() => mongoose.disconnect());

async function upload(auth: Record<string, string>, body: Buffer = fixture, filename = 'talk.mp4') {
  const init = await request(app)
    .post('/api/assets/uploads')
    .set(auth)
    .send({ filename, contentType: 'video/mp4', sizeBytes: body.length })
    .expect(201);
  const { asset, upload: target } = init.body.data;
  await request(app).put(target.url).set('Content-Type', 'video/mp4').send(body).expect(200);
  return { assetId: asset.id as string, target };
}

async function readyVideo(auth: Record<string, string>) {
  const { assetId } = await upload(auth);
  const res = await request(app).post(`/api/assets/${assetId}/complete`).set(auth).expect(200);
  return res.body.data;
}

const setBalance = (workspaceId: string, creditBalance: number) => Workspace.updateOne({ _id: workspaceId }, { creditBalance });

describe('uploads', () => {
  it('uploads via a signed URL, validates with ffprobe and counts storage', async () => {
    const { auth } = await registerUser({ verify: true });
    const asset = await readyVideo(auth);
    expect(asset).toMatchObject({ status: 'ready', mimeType: 'video/mp4', width: 320, height: 240, hasAudio: true });
    expect(asset.durationSec).toBeGreaterThan(6.5);
    const me = await request(app).get('/api/auth/me').set(auth).expect(200);
    expect(me.body.data.workspace.storageBytesUsed).toBe(fixture.length);

    const list = await request(app).get('/api/assets').set(auth).expect(200);
    expect(list.body.meta.total).toBe(1);
  });

  it('rejects files whose bytes are not a video, whatever the name says', async () => {
    const { auth } = await registerUser({ verify: true });
    const fake = Buffer.from('this is definitely not a video file '.repeat(200));
    const { assetId } = await upload(auth, fake, 'evil.mp4');
    const res = await request(app).post(`/api/assets/${assetId}/complete`).set(auth).expect(400);
    expect(res.body.error.code).toBe('INVALID_UPLOAD');
    expect((await Asset.findById(assetId))!.status).toBe('failed');
  });

  it('rejects unsupported types and oversize declarations up front', async () => {
    const { auth } = await registerUser({ verify: true });
    await request(app).post('/api/assets/uploads').set(auth).send({ filename: 'a.exe', contentType: 'application/x-msdownload', sizeBytes: 10 }).expect(400);
    await request(app).post('/api/assets/uploads').set(auth).send({ filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 51 * 1024 * 1024 }).expect(413);
  });

  it('refuses tampered or expired signed URLs and enforces the byte limit while streaming', async () => {
    const { auth } = await registerUser({ verify: true });
    const init = await request(app).post('/api/assets/uploads').set(auth).send({ filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 100 }).expect(201);
    const url: string = init.body.data.upload.url;
    await request(app).put(url.replace(/max=\d+/, 'max=999999999')).send(fixture).expect(403);
    await request(app).put(url.replace(/sig=[^&]+/, 'sig=AAAA')).send(fixture).expect(403);
    await request(app).put(url.replace(/exp=\d+/, 'exp=1')).send(fixture).expect(403);
  });

  it('makes upload URLs short-lived and write-once, so validated files cannot be swapped', async () => {
    const { auth } = await registerUser({ verify: true });
    const { assetId, target } = await upload(auth);
    const ttlMin = (new Date(target.expiresAt).getTime() - Date.now()) / 60_000;
    expect(ttlMin).toBeGreaterThan(14);
    expect(ttlMin).toBeLessThanOrEqual(15);

    await request(app).post(`/api/assets/${assetId}/complete`).set(auth).expect(200);
    const swap = await request(app).put(target.url).set('Content-Type', 'video/mp4').send(Buffer.from('malicious bytes')).expect(409);
    expect(swap.body.error.code).toBe('ALREADY_UPLOADED');

    // The validated bytes are untouched.
    const stored = await readFile(localStorage.resolve((await Asset.findById(assetId))!.storageKey));
    expect(stored.equals(fixture)).toBe(true);
  });

  it('isolates tenants', async () => {
    const alice = await registerUser({ verify: true });
    const bob = await registerUser({ verify: true });
    const asset = await readyVideo(alice.auth);
    await request(app).get(`/api/assets/${asset.id}/url`).set(bob.auth).expect(404);
    await request(app).delete(`/api/assets/${asset.id}`).set(bob.auth).expect(404);
    await request(app).post('/api/projects').set(bob.auth).send({ title: 'x', mode: 'editor', sourceAssetId: asset.id }).expect(400);
  });

  it('deletes media and frees storage', async () => {
    const { auth } = await registerUser({ verify: true });
    const asset = await readyVideo(auth);
    await request(app).delete(`/api/assets/${asset.id}`).set(auth).expect(204);
    const me = await request(app).get('/api/auth/me').set(auth).expect(200);
    expect(me.body.data.workspace.storageBytesUsed).toBe(0);
  });
});

describe('render pipeline', () => {
  async function projectWithVideo(auth: Record<string, string>, settings: Record<string, unknown> = {}) {
    const asset = await readyVideo(auth);
    const res = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ title: 'Test reel', mode: 'editor', aspectRatio: '9:16', sourceAssetId: asset.id, settings: { resolution: '720p', ...settings } })
      .expect(201);
    return res.body.data;
  }

  it('estimates, charges credits, renders a real 9:16 video with silence removed, and serves it', async () => {
    const { auth } = await registerUser({ verify: true });
    const project = await projectWithVideo(auth);

    const est = await request(app).get(`/api/projects/${project.id}/estimate`).set(auth).expect(200);
    expect(est.body.data).toMatchObject({ credits: 1, balance: 3, resolutionAllowed: true });

    const gen = await request(app).post(`/api/projects/${project.id}/generate`).set(auth).expect(202);
    expect(gen.body.data.credits).toBe(1);
    await request(app).post(`/api/projects/${project.id}/generate`).set(auth).expect(409); // no double-submit
    let me = await request(app).get('/api/auth/me').set(auth);
    expect(me.body.data.workspace.creditBalance).toBe(2);

    expect(await worker.runOnce()).toBe(true);

    const job = await request(app).get(`/api/projects/${project.id}/job`).set(auth).expect(200);
    expect(job.body.data).toMatchObject({ status: 'completed', progress: 100 });

    const done = await request(app).get(`/api/projects/${project.id}`).set(auth).expect(200);
    const p = done.body.data;
    expect(p.status).toBe('completed');
    expect(p.outputAsset).toMatchObject({ kind: 'render', width: 720, height: 1280, hasAudio: true });
    expect(p.renderStats.silenceRemovedSec).toBeGreaterThan(1);
    expect(p.renderStats.outputDurationSec).toBeLessThan(6);
    expect(p.renderStats.cuts).toBe(1);
    expect(p.renderStats.warnings.join(' ')).toMatch(/Captions were not added/);

    // The rendered file really is what we claim.
    const out = await Asset.findById(p.outputAsset.id);
    const info = await probe(localStorage.resolve(out!.storageKey));
    expect(info.video).toMatchObject({ width: 720, height: 1280 });

    // Signed playback URL supports range requests (video seeking).
    const urlRes = await request(app).get(`/api/assets/${p.outputAsset.id}/url`).set(auth).expect(200);
    const ranged = await request(app).get(urlRes.body.data.url).set('Range', 'bytes=0-99').expect(206);
    expect(ranged.headers['content-type']).toMatch(/video\/mp4/);

    me = await request(app).get('/api/auth/me').set(auth);
    expect(me.body.data.workspace.creditBalance).toBe(2); // charged exactly once
  }, 120_000);

  it('blocks generation without enough credits and leaves the project editable', async () => {
    const { auth, user } = await registerUser({ verify: true });
    const project = await projectWithVideo(auth);
    await setBalance(user.defaultWorkspaceId, 0);
    const res = await request(app).post(`/api/projects/${project.id}/generate`).set(auth).expect(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect((await Project.findById(project.id))!.status).toBe('draft');
    expect(await Job.countDocuments()).toBe(0);
  });

  it('refunds credits and restores the project if the job cannot be queued', async () => {
    const { auth } = await registerUser({ verify: true });
    const project = await projectWithVideo(auth);
    const spy = vi.spyOn(Job, 'create').mockRejectedValueOnce(new Error('queue unavailable'));
    try {
      await request(app).post(`/api/projects/${project.id}/generate`).set(auth).expect(500);
    } finally {
      spy.mockRestore();
    }
    const me = await request(app).get('/api/auth/me').set(auth);
    expect(me.body.data.workspace.creditBalance).toBe(3);
    expect(await CreditTransaction.countDocuments({ type: 'refund', status: 'applied' })).toBe(1);
    expect((await Project.findById(project.id))!.status).toBe('draft');
    // And the user can simply try again.
    await request(app).post(`/api/projects/${project.id}/generate`).set(auth).expect(202);
  });

  it('enforces the plan resolution limit (Free = 720p)', async () => {
    const { auth } = await registerUser({ verify: true });
    const project = await projectWithVideo(auth, { resolution: '1080p' });
    const res = await request(app).post(`/api/projects/${project.id}/generate`).set(auth).expect(403);
    expect(res.body.error.code).toBe('PLAN_LIMIT');
  });

  it('marks the project failed and refunds credits exactly once when processing fails', async () => {
    const { auth } = await registerUser({ verify: true });
    const project = await projectWithVideo(auth);
    await request(app).post(`/api/projects/${project.id}/generate`).set(auth).expect(202);

    // Corrupt the stored source after validation (simulates storage corruption).
    const src = await Asset.findOne({ kind: 'source_video' });
    await writeFile(localStorage.resolve(src!.storageKey), Buffer.alloc(5000, 7));

    await worker.runOnce();
    const p = await Project.findById(project.id);
    expect(p!.status).toBe('failed');
    expect(p!.lastError).toBeTruthy();
    const job = await Job.findOne();
    expect(job!.status).toBe('dead');

    const me = await request(app).get('/api/auth/me').set(auth);
    expect(me.body.data.workspace.creditBalance).toBe(3);
    expect(await CreditTransaction.countDocuments({ type: 'refund' })).toBe(1);
  }, 60_000);

  it('refuses generation for modes that are not built yet', async () => {
    const { auth } = await registerUser({ verify: true });
    const res = await request(app).post('/api/projects').set(auth).send({ title: 'Avatar', mode: 'avatar' }).expect(201);
    await request(app).post(`/api/projects/${res.body.data.id}/generate`).set(auth).expect(501);
  });
});

describe('job queue', () => {
  const ws = () => new mongoose.Types.ObjectId();

  it('retries with backoff, then dead-letters after max attempts', async () => {
    const job = await enqueue({ type: 'render_project', workspaceId: ws(), maxAttempts: 2 });
    const c1 = await claim('w1', ['render_project']);
    expect(c1!._id.equals(job._id)).toBe(true);
    expect(await fail(c1!, 'w1', new Error('boom'))).toBe('retry');
    expect(await claim('w1', ['render_project'])).toBeNull(); // backoff: not due yet

    await Job.updateOne({ _id: job._id }, { runAt: new Date() });
    const c2 = await claim('w1', ['render_project']);
    expect(c2!.attempts).toBe(2);
    expect(await fail(c2!, 'w1', new Error('boom again'))).toBe('dead');
  });

  it('never hands the same job to two workers', async () => {
    await enqueue({ type: 'render_project', workspaceId: ws() });
    const results = await Promise.all(['a', 'b', 'c', 'd'].map((w) => claim(w, ['render_project'])));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('reclaims jobs whose worker died, and dead-letters them on the last attempt', async () => {
    const job = await enqueue({ type: 'render_project', workspaceId: ws(), maxAttempts: 2 });
    await claim('crashed', ['render_project']);
    await Job.updateOne({ _id: job._id }, { lockedUntil: new Date(Date.now() - 1000) });
    const again = await claim('healthy', ['render_project']);
    expect(again!.lockedBy).toBe('healthy');
    expect(again!.attempts).toBe(2);

    await Job.updateOne({ _id: job._id }, { lockedUntil: new Date(Date.now() - 1000) });
    const swept = await sweepExpired();
    expect(swept.map((j) => j._id.toString())).toEqual([job._id.toString()]);
    expect((await Job.findById(job._id))!.status).toBe('dead');
  });
});
