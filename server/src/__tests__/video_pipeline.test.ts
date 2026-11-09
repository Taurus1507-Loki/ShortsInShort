import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { Transcript } from '../models/Transcript.js';
import { setTranscriptionProvider, TranscriptionError, type TranscriptionProvider, type Word } from '../services/ai/transcription.js';
import { setLLMProvider, type LLMProvider } from '../services/ai/llm.js';
import { setStockProvider, type StockVideoProvider } from '../services/ai/stock.js';

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
    // The upload plus its poster thumbnail (generated for the live preview).
    const stored = await Asset.findById(asset.id);
    expect(stored!.thumbnailAssetId).toBeTruthy();
    const thumb = await Asset.findById(stored!.thumbnailAssetId);
    expect(thumb).toMatchObject({ kind: 'thumbnail', status: 'ready', mimeType: 'image/jpeg' });
    expect(me.body.data.workspace.storageBytesUsed).toBe(fixture.length + thumb!.sizeBytes);

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

  it('shows the whole picture over a blurred background when framing is "blur" (and auto picks it for landscape → vertical)', async () => {
    const { auth, user } = await registerUser({ verify: true });
    await setBalance(user.defaultWorkspaceId, 10);
    // 16:9 source with yellow bars on its far left/right edges: a vertical crop cuts them off,
    // a fit-over-blur keeps the whole picture, so the bars stay visible.
    const dir = await mkdtemp(path.join(tmpdir(), 'sis-edges-'));
    const src = path.join(dir, 'edges.mp4');
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=25:d=3,drawbox=x=0:y=0:w=48:h=360:color=yellow:t=fill,drawbox=x=592:y=0:w=48:h=360:color=yellow:t=fill',
      '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src,
    ]);
    const body = await readFile(src);
    const { assetId } = await upload(auth, body, 'edges.mp4');
    await request(app).post(`/api/assets/${assetId}/complete`).set(auth).expect(200);

    const render = async (framing: string) => {
      const res = await request(app)
        .post('/api/projects')
        .set(auth)
        .send({ title: `Framing ${framing}`, mode: 'editor', aspectRatio: '9:16', sourceAssetId: assetId, settings: { resolution: '720p', framing, captionsEnabled: false } })
        .expect(201);
      await request(app).post(`/api/projects/${res.body.data.id}/generate`).set(auth).expect(202);
      await worker.runOnce();
      return (await request(app).get(`/api/projects/${res.body.data.id}`).set(auth).expect(200)).body.data;
    };
    /** Fraction of yellow pixels along the frame's middle row. */
    const yellowInMiddleRow = async (assetId2: string) => {
      const a = await Asset.findById(assetId2);
      const d = await mkdtemp(path.join(tmpdir(), 'sis-row-'));
      const file = path.join(d, 'row.rgb');
      await runFfmpeg(['-ss', '1', '-i', localStorage.resolve(a!.storageKey), '-frames:v', '1', '-vf', 'crop=iw:2:0:ih/2,format=rgb24', '-f', 'rawvideo', file]);
      const px = await readFile(file);
      let yellow = 0;
      for (let i = 0; i < px.length; i += 3) if (px[i]! > 180 && px[i + 1]! > 180 && px[i + 2]! < 90) yellow++;
      return yellow / (px.length / 3);
    };

    const auto = await render('auto');
    expect(auto.renderStats.framing).toBe('blur'); // 16:9 into 9:16
    expect(auto.outputAsset).toMatchObject({ width: 720, height: 1280 });
    const crop = await render('crop');
    expect(crop.renderStats.framing).toBe('crop');

    expect(await yellowInMiddleRow(crop.outputAsset.id)).toBe(0); // edges cropped away
    expect(await yellowInMiddleRow(auto.outputAsset.id)).toBeGreaterThan(0.08); // whole picture kept
  }, 180_000);

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

describe('captions (with a stand-in transcription provider)', () => {
  // Words aligned to the fixture: tone 0–2.5s, silence 2.5–4.5s, tone 4.5–7s. "um" is a filler.
  const WORDS: Word[] = [
    { text: 'Consistency', start: 0.2, end: 0.9 },
    { text: 'beats', start: 0.95, end: 1.4 },
    { text: 'talent.', start: 1.45, end: 2.2 },
    { text: 'um', start: 4.6, end: 4.95, filler: true },
    { text: 'Every', start: 5.0, end: 5.5 },
    { text: 'single', start: 5.55, end: 6.0 },
    { text: 'time.', start: 6.05, end: 6.7 },
  ];
  let calls = 0;
  const fake: TranscriptionProvider = {
    name: 'fake-test',
    async transcribe(_audio, opts) {
      calls++;
      return { provider: 'fake-test', language: opts.language, words: WORDS };
    },
  };
  afterEach(() => {
    setTranscriptionProvider(undefined);
    calls = 0;
  });

  /** Mean absolute luminance difference of the lower-middle band of two frames. */
  async function frameAt(assetId: string, sec: number) {
    const out = await Asset.findById(assetId);
    const dir = await mkdtemp(path.join(tmpdir(), 'sis-frame-'));
    const file = path.join(dir, 'f.gray');
    await runFfmpeg(['-ss', String(sec), '-i', localStorage.resolve(out!.storageKey), '-frames:v', '1', '-vf', 'crop=iw:ih*0.3:0:ih*0.55,scale=144:-2,format=gray', '-f', 'rawvideo', file]);
    return readFile(file);
  }
  const diff = (a: Buffer, b: Buffer) => {
    let sum = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) sum += Math.abs(a[i]! - b[i]!);
    return sum / Math.min(a.length, b.length);
  };

  async function renderProject(auth: Record<string, string>, projectId: string) {
    await request(app).post(`/api/projects/${projectId}/generate`).set(auth).expect(202);
    await worker.runOnce();
    return (await request(app).get(`/api/projects/${projectId}`).set(auth).expect(200)).body.data;
  }

  it('transcribes once, removes filler words and burns real captions into the video', async () => {
    setTranscriptionProvider(fake);
    const { auth, user } = await registerUser({ verify: true });
    await setBalance(user.defaultWorkspaceId, 10);
    const asset = await readyVideo(auth);
    const res = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ title: 'Caps', mode: 'editor', aspectRatio: '9:16', sourceAssetId: asset.id, settings: { resolution: '720p', captionsEnabled: false, captionStyle: 'boxed', framing: 'crop' } })
      .expect(201);

    const plain = await renderProject(auth, res.body.data.id);
    expect(plain.renderStats).toMatchObject({ captionsAdded: false, fillerWordsRemoved: 1 });
    const plainFrame = await frameAt(plain.outputAsset.id, 0.6);

    await request(app).patch(`/api/projects/${res.body.data.id}`).set(auth).send({ settings: { captionsEnabled: true } }).expect(200);
    const captioned = await renderProject(auth, res.body.data.id);
    expect(captioned.renderStats).toMatchObject({ captionsAdded: true, fillerWordsRemoved: 1 });
    expect(captioned.renderStats.warnings.join(' ')).not.toMatch(/Captions were not added/);
    expect(captioned.renderStats.outputDurationSec).toBeCloseTo(plain.renderStats.outputDurationSec, 1);

    // Same source, same cut: the only visual difference is the burned-in caption box.
    const capFrame = await frameAt(captioned.outputAsset.id, 0.6);
    expect(diff(plainFrame, capFrame)).toBeGreaterThan(8);

    expect(calls).toBe(1); // second render reused the cached transcript
    expect(await Transcript.countDocuments()).toBe(1);
  }, 180_000);

  it('applies edited captions on re-render, and sets them aside if the cut changes', async () => {
    setTranscriptionProvider(fake);
    const { auth, user } = await registerUser({ verify: true });
    await setBalance(user.defaultWorkspaceId, 10);
    const asset = await readyVideo(auth);
    const res = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ title: 'Edit me', mode: 'editor', sourceAssetId: asset.id, settings: { resolution: '720p', captionsEnabled: true, captionStyle: 'clean_minimal', bRollIntensity: 'none' } })
      .expect(201);
    const id = res.body.data.id;

    // Editing before any render is refused.
    await request(app).put(`/api/projects/${id}/captions`).set(auth).send({ lines: [{ start: 0, end: 1, text: 'x' }] }).expect(400);

    const first = await renderProject(auth, id);
    expect(first.captionLines.length).toBeGreaterThan(0);
    expect(first.captionsEdited).toBe(false);
    const original = first.captionLines as Array<{ start: number; end: number; text: string; keyword: string }>;

    // Validation: overlapping lines, keyword not in the text, empty text.
    const bad = (lines: unknown) => request(app).put(`/api/projects/${id}/captions`).set(auth).send({ lines }).expect(400);
    await bad([{ start: 0, end: 2, text: 'a' }, { start: 1, end: 3, text: 'b' }]);
    await bad([{ start: 0, end: 1, text: 'hello there', keyword: 'nope' }]);
    await bad([{ start: 0, end: 1, text: '   ' }]);

    const edited = original.map((l, i) => (i === 0 ? { ...l, text: 'Discipline beats motivation', keyword: 'Discipline' } : l));
    const saved = await request(app).put(`/api/projects/${id}/captions`).set(auth).send({ lines: edited }).expect(200);
    expect(saved.body.data.captionsEdited).toBe(true);

    const second = await renderProject(auth, id);
    expect(second.renderStats.captionsFromEdits).toBe(true);
    expect(second.captionLines[0]).toMatchObject({ text: 'Discipline beats motivation', keyword: 'Discipline' });
    expect(second.captionLines.slice(1).map((l: { text: string }) => l.text)).toEqual(original.slice(1).map((l) => l.text));
    expect(calls).toBe(1); // transcript reused, no new transcription

    // A different editing intensity changes the cut → edits are set aside, with a note.
    await request(app).patch(`/api/projects/${id}`).set(auth).send({ settings: { editingIntensity: 'high' } }).expect(200);
    const third = await renderProject(auth, id);
    expect(third.renderStats.captionsFromEdits).toBe(false);
    expect(third.captionsEdited).toBe(false);
    expect(third.renderStats.warnings.join(' ')).toMatch(/caption edits were not used because the cut changed/);
  }, 240_000);

  it('still renders, with an honest note, when transcription fails', async () => {
    setTranscriptionProvider({
      name: 'broken',
      async transcribe() {
        throw new TranscriptionError("Transcription isn't available for this language or audio.");
      },
    });
    const { auth } = await registerUser({ verify: true });
    const asset = await readyVideo(auth);
    const res = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ title: 'NoCaps', mode: 'editor', sourceAssetId: asset.id, settings: { resolution: '720p', captionsEnabled: true } })
      .expect(201);
    const p = await renderProject(auth, res.body.data.id);
    expect(p.status).toBe('completed');
    expect(p.renderStats.captionsAdded).toBe(false);
    expect(p.renderStats.warnings.join(' ')).toMatch(/Captions were not added: Transcription isn't available/);
  }, 120_000);

  it('reports captions as enabled in /meta only when a provider is configured', async () => {
    setTranscriptionProvider(null);
    expect((await request(app).get('/api/meta')).body.data.features.captions).toBe(false);
    setTranscriptionProvider(fake);
    expect((await request(app).get('/api/meta')).body.data.features.captions).toBe(true);
  });
});

describe('AI keywords, translation and B-roll (stand-in providers)', () => {
  // 12 s of continuous speech-like tone (no pauses → no cuts), so timings stay predictable.
  const WORDS: Word[] = [
    { text: 'Small', start: 0.2, end: 0.6 }, { text: 'habits', start: 0.65, end: 1.1 }, { text: 'win.', start: 1.15, end: 2.8 },
    { text: 'Drink', start: 3.5, end: 4.2 }, { text: 'coffee', start: 4.3, end: 5.4 }, { text: 'every', start: 5.5, end: 6.4 }, { text: 'morning.', start: 6.5, end: 8.0 },
    { text: 'Then', start: 8.5, end: 9.2 }, { text: 'go', start: 9.3, end: 9.8 }, { text: 'running.', start: 9.9, end: 11.4 },
  ];
  let llmCalls: string[] = [];
  const llm: LLMProvider = {
    name: 'fake-llm',
    async generateJson<T>(prompt: string, schema: { properties?: Record<string, unknown> }) {
      const key = Object.keys(schema.properties ?? {})[0]!;
      llmCalls.push(key);
      // The prompt ends with the caption lines as a JSON array; answer one keyword per line (its last word).
      if (key === 'keywords') return { keywords: (JSON.parse(prompt.split(String.fromCharCode(10)).at(-1)!) as string[]).map((l) => l.split(' ').at(-1)!) } as T;
      if (key === 'moments') return { moments: [{ sentence: 1, queries: ['latte art', 'coffee cup'] }] } as T;
      throw new Error('unexpected');
    },
  };
  let redClip = '';
  let longFixture: Buffer;
  const stock: StockVideoProvider = {
    name: 'fake-stock',
    license: 'test',
    async searchVideos(query) {
      // Only 'coffee cup' has a matching clip; 'latte art' returns an unrelated one that must be rejected.
      if (query === 'latte art') return [{ id: 'trees', provider: 'fake-stock', downloadUrl: 'local', pageUrl: 'https://example.test/trees', author: 'x', width: 640, height: 360, durationSec: 6, tags: ['trees', 'forest'] }];
      return [{ id: 'red-1', provider: 'fake-stock', downloadUrl: 'local', pageUrl: `https://example.test/${encodeURIComponent(query)}`, author: 'tester', width: 640, height: 360, durationSec: 6, tags: ['coffee', 'cup'] }];
    },
    async download(_clip, dest) {
      await writeFile(dest, await readFile(redClip));
    },
  };

  beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sis-ai-'));
    redClip = path.join(dir, 'red.mp4');
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=25:d=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', redClip]);
    const long = path.join(dir, 'long.mp4');
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=12',
      '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=12',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', long,
    ]);
    longFixture = await readFile(long);
  }, 120_000);

  beforeEach(() => {
    llmCalls = [];
    setTranscriptionProvider({ name: 'fake-stt', async transcribe(_a, o) { return { provider: 'fake-stt', language: o.language, words: WORDS }; } });
    setLLMProvider(llm);
    setStockProvider(stock);
  });
  afterEach(() => {
    setTranscriptionProvider(undefined);
    setLLMProvider(undefined);
    setStockProvider(undefined);
  });

  /** Average RGB of a frame's centre at time `sec`. */
  async function centreColour(assetId: string, sec: number) {
    const a = await Asset.findById(assetId);
    const d = await mkdtemp(path.join(tmpdir(), 'sis-px-'));
    const file = path.join(d, 'px.rgb');
    await runFfmpeg(['-ss', String(sec), '-i', localStorage.resolve(a!.storageKey), '-frames:v', '1', '-vf', 'crop=iw*0.3:ih*0.2:iw*0.35:ih*0.3,scale=16:16,format=rgb24', '-f', 'rawvideo', file]);
    const px = await readFile(file);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < px.length; i += 3) { r += px[i]!; g += px[i + 1]!; b += px[i + 2]!; }
    const n = px.length / 3;
    return { r: r / n, g: g / n, b: b / n };
  }

  it('shows the stock clip only during its planned slot, with AI keywords on the captions', async () => {
    const { auth, user } = await registerUser({ verify: true });
    await setBalance(user.defaultWorkspaceId, 10);
    const { assetId } = await upload(auth, longFixture, 'long.mp4');
    await request(app).post(`/api/assets/${assetId}/complete`).set(auth).expect(200);
    const res = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ title: 'B-roll', mode: 'editor', aspectRatio: '9:16', sourceAssetId: assetId, settings: { resolution: '720p', framing: 'crop', bRollIntensity: 'high', editingIntensity: 'low' } })
      .expect(201);
    await request(app).post(`/api/projects/${res.body.data.id}/generate`).set(auth).expect(202);
    await worker.runOnce();
    const p = (await request(app).get(`/api/projects/${res.body.data.id}`).set(auth).expect(200)).body.data;

    expect(p.status).toBe('completed');
    expect(p.renderStats).toMatchObject({ captionsAdded: true, aiKeywords: true, brollCount: 1 });
    expect(p.renderStats.broll[0]).toMatchObject({ query: 'coffee cup', provider: 'fake-stock', author: 'tester' });
    const { start, end } = p.renderStats.broll[0];
    expect(start).toBeCloseTo(3.65, 1);
    expect(end).toBeCloseTo(7.15, 1);
    expect(p.renderStats.warnings.join(' ')).not.toMatch(/B-roll was not added/);
    expect(llmCalls.sort()).toEqual(['keywords', 'moments']);

    const during = await centreColour(p.outputAsset.id, 5);
    expect(during.r).toBeGreaterThan(200);
    expect(during.g).toBeLessThan(60);
    const before = await centreColour(p.outputAsset.id, 1);
    expect(before.r > 200 && before.g < 60 && before.b < 60).toBe(false); // the speaker, not the clip
    const after = await centreColour(p.outputAsset.id, 9);
    expect(after.r > 200 && after.g < 60 && after.b < 60).toBe(false);
  }, 180_000);

  it('translates captions when a different caption language is chosen', async () => {
    setLLMProvider({
      name: 'fake-translate',
      async generateJson<T>(prompt: string, schema: { properties?: Record<string, unknown> }) {
        const key = Object.keys(schema.properties ?? {})[0]!;
        llmCalls.push(key);
        if (key !== 'lines') throw new Error('unexpected');
        const n = (JSON.parse(prompt.split(String.fromCharCode(10)).at(-1)!) as string[]).length;
        return { lines: Array.from({ length: n }, (_, i) => ({ text: `अनुवाद ${i + 1}`, keyword: 'अनुवाद' })) } as T;
      },
    });
    const { auth } = await registerUser({ verify: true });
    const { assetId } = await upload(auth, longFixture, 'long.mp4');
    await request(app).post(`/api/assets/${assetId}/complete`).set(auth).expect(200);
    const res = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ title: 'Translate', mode: 'editor', sourceAssetId: assetId, settings: { resolution: '720p', bRollIntensity: 'none', captionStyle: 'clean_minimal', captionLanguage: 'hi', editingIntensity: 'low' } })
      .expect(201);
    await request(app).post(`/api/projects/${res.body.data.id}/generate`).set(auth).expect(202);
    await worker.runOnce();
    const p = (await request(app).get(`/api/projects/${res.body.data.id}`).set(auth).expect(200)).body.data;
    expect(p.status).toBe('completed');
    expect(llmCalls).toEqual(['lines']);
    expect(p.renderStats.captionsTranslatedTo).toBe('hi');
    expect(p.renderStats.warnings.join(' ')).not.toMatch(/translat/i);
  }, 120_000);

  it('skips B-roll with an honest note when the stock provider is missing', async () => {
    setStockProvider(null);
    const { auth } = await registerUser({ verify: true });
    const { assetId } = await upload(auth, longFixture, 'long.mp4');
    await request(app).post(`/api/assets/${assetId}/complete`).set(auth).expect(200);
    const res = await request(app).post('/api/projects').set(auth).send({ title: 'NoStock', mode: 'editor', sourceAssetId: assetId, settings: { resolution: '720p', bRollIntensity: 'medium' } }).expect(201);
    await request(app).post(`/api/projects/${res.body.data.id}/generate`).set(auth).expect(202);
    await worker.runOnce();
    const p = (await request(app).get(`/api/projects/${res.body.data.id}`).set(auth).expect(200)).body.data;
    expect(p.renderStats.brollCount).toBe(0);
    expect(p.renderStats.warnings.join(' ')).toMatch(/B-roll was not added: stock media search is not enabled/);
  }, 120_000);
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
