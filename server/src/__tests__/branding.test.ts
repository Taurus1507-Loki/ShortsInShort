import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { runFfmpeg } from '../services/video/ffmpeg.js';
import { localStorage } from '../services/storage/storage.js';
import { Worker } from '../services/queue/worker.js';
import { registerRenderJob } from '../services/video/renderJob.js';
import { Asset } from '../models/Asset.js';
import { Workspace } from '../models/Workspace.js';
import { env } from '../config/env.js';

const worker = new Worker(1, 10);
let blackClip: Buffer; // 3 s black frame + 300 Hz tone (the "speaker")
let greenLogo: Buffer;
let musicTone = '';

beforeAll(async () => {
  await connectTestDb();
  registerRenderJob();
  const dir = await mkdtemp(path.join(tmpdir(), 'sis-brand-'));
  const clip = path.join(dir, 'black.mp4');
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=25:d=3',
    '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip,
  ]);
  blackClip = await readFile(clip);
  const logo = path.join(dir, 'logo.png');
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=0x00FF00:s=300x150', '-frames:v', '1', logo]);
  greenLogo = await readFile(logo);
  musicTone = path.join(dir, 'tone.mp3');
  // Loud like a mastered track (lavfi's default sine is only 1/8 amplitude).
  await runFfmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*1000*t)':s=48000:d=4", '-c:a', 'libmp3lame', '-b:a', '128k', musicTone]);
}, 120_000);
beforeEach(resetDb);
afterAll(() => mongoose.disconnect());

async function uploadFile(auth: Record<string, string>, body: Buffer, filename: string, contentType: string, purpose?: 'logo') {
  const init = await request(app).post('/api/assets/uploads').set(auth).send({ filename, contentType, sizeBytes: body.length, ...(purpose ? { purpose } : {}) });
  if (init.status !== 201) return { init };
  await request(app).put(init.body.data.upload.url).set('Content-Type', contentType).send(body).expect(200);
  const done = await request(app).post(`/api/assets/${init.body.data.asset.id}/complete`).set(auth);
  return { init, done };
}

async function renderBlack(auth: Record<string, string>, settings: Record<string, unknown> = {}) {
  const { done } = await uploadFile(auth, blackClip, 'black.mp4', 'video/mp4');
  const res = await request(app)
    .post('/api/projects')
    .set(auth)
    .send({ title: 'Brand test', mode: 'editor', aspectRatio: '16:9', sourceAssetId: done!.body.data.id, settings: { resolution: '720p', framing: 'crop', bRollIntensity: 'none', zoomIntensity: 'off', musicMood: 'none', ...settings } })
    .expect(201);
  await request(app).post(`/api/projects/${res.body.data.id}/generate`).set(auth).expect(202);
  await worker.runOnce();
  return (await request(app).get(`/api/projects/${res.body.data.id}`).set(auth).expect(200)).body.data;
}

/** RGB pixels of a region (fractions of the frame) at t=1s. */
async function region(assetId: string, crop: string, scaleW = 32) {
  const a = await Asset.findById(assetId);
  const d = await mkdtemp(path.join(tmpdir(), 'sis-reg-'));
  const f = path.join(d, 'r.rgb');
  await runFfmpeg(['-ss', '1', '-i', localStorage.resolve(a!.storageKey), '-frames:v', '1', '-vf', `crop=${crop},scale=${scaleW}:-2,format=rgb24`, '-f', 'rawvideo', f]);
  return readFile(f);
}
const maxLuma = (px: Buffer) => {
  let m = 0;
  for (let i = 0; i < px.length; i += 3) m = Math.max(m, 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!);
  return m;
};

const setPlan = (workspaceId: string, plan: string) => Workspace.updateOne({ _id: workspaceId }, { plan, creditBalance: 20 });

describe('Free-plan watermark', () => {
  it('appears top-right on Free exports and not on paid plans', async () => {
    const free = await registerUser({ verify: true });
    await setPlan(free.user.defaultWorkspaceId, 'free');
    const f = await renderBlack(free.auth);
    expect(f.renderStats.watermark).toBe(true);
    expect(maxLuma(await region(f.outputAsset.id, 'iw*0.45:ih*0.08:iw*0.55:0', 576))).toBeGreaterThan(80); // full resolution: thin text

    const paid = await registerUser({ verify: true });
    await setPlan(paid.user.defaultWorkspaceId, 'starter');
    const p = await renderBlack(paid.auth);
    expect(p.renderStats.watermark).toBe(false);
    expect(maxLuma(await region(p.outputAsset.id, 'iw*0.45:ih*0.08:iw*0.55:0', 576))).toBeLessThan(30);
  }, 180_000);
});

describe('Brand Kit', () => {
  it('validates logo uploads: real PNG/JPG/WEBP only', async () => {
    const { auth } = await registerUser({ verify: true });
    const svg = await uploadFile(auth, Buffer.from('<svg/>'), 'logo.svg', 'image/svg+xml', 'logo');
    expect(svg.init.status).toBe(400);
    const fake = await uploadFile(auth, Buffer.from('not an image at all '.repeat(50)), 'logo.png', 'image/png', 'logo');
    expect(fake.done!.status).toBe(400);
    const ok = await uploadFile(auth, greenLogo, 'logo.png', 'image/png', 'logo');
    expect(ok.done!.body.data).toMatchObject({ kind: 'brand_logo', width: 300, height: 150, mimeType: 'image/png' });
  });

  it('creates defaults, validates updates and rejects another workspace’s logo', async () => {
    const alice = await registerUser({ verify: true });
    const bob = await registerUser({ verify: true });
    const kit = await request(app).get('/api/brand-kit').set(alice.auth).expect(200);
    expect(kit.body.data).toMatchObject({ logo: null, logoPosition: 'top-right', primaryColor: '#7C3AED', applyToNewProjects: true });
    await request(app).put('/api/brand-kit').set(alice.auth).send({ primaryColor: 'purple' }).expect(400);
    await request(app).put('/api/brand-kit').set(alice.auth).send({ font: 'Comic Sans' }).expect(400);
    const bobLogo = await uploadFile(bob.auth, greenLogo, 'logo.png', 'image/png', 'logo');
    await request(app).put('/api/brand-kit').set(alice.auth).send({ logoAssetId: bobLogo.done!.body.data.id }).expect(400);
    const upd = await request(app).put('/api/brand-kit').set(alice.auth).send({ captionStyle: 'boxed', highlightColor: '#FF0055' }).expect(200);
    expect(upd.body.data).toMatchObject({ captionStyle: 'boxed', highlightColor: '#FF0055' });
  });

  it('overlays the logo in the chosen corner, and can be turned off per project', async () => {
    const { auth, user } = await registerUser({ verify: true });
    await setPlan(user.defaultWorkspaceId, 'starter'); // no watermark in the way
    const logo = await uploadFile(auth, greenLogo, 'logo.png', 'image/png', 'logo');
    await request(app).put('/api/brand-kit').set(auth).send({ logoAssetId: logo.done!.body.data.id, logoPosition: 'top-left', logoOpacity: 1 }).expect(200);

    const withLogo = await renderBlack(auth);
    expect(withLogo.renderStats.logoApplied).toBe(true);
    const px = await region(withLogo.outputAsset.id, 'iw*0.15:ih*0.1:iw*0.05:ih*0.05');
    let green = 0;
    for (let i = 0; i < px.length; i += 3) if (px[i + 1]! > 180 && px[i]! < 80 && px[i + 2]! < 80) green++;
    expect(green / (px.length / 3)).toBeGreaterThan(0.5);

    const off = await renderBlack(auth, { useBrandKit: false });
    expect(off.renderStats.logoApplied).toBe(false);
    expect(maxLuma(await region(off.outputAsset.id, 'iw*0.15:ih*0.1:iw*0.05:ih*0.05'))).toBeLessThan(30);
  }, 180_000);
});

describe('licensed background music', () => {
  const manifest = () => path.join(env.music.libraryDir!, 'music.json');
  const installTone = async () => {
    await writeFile(path.join(env.music.libraryDir!, 'tone.mp3'), await readFile(musicTone));
    await writeFile(manifest(), JSON.stringify([{ file: 'tone.mp3', title: 'Test Tone', artist: 'Lab', moods: ['calm'], license: 'Test licence' }]));
  };
  afterAll(async () => {
    await rm(manifest(), { force: true });
  });

  /** Uploads a generated clip and renders it with the given settings. */
  async function renderClip(auth: Record<string, string>, clip: Buffer, settings: Record<string, unknown>) {
    const { done } = await uploadFile(auth, clip, 'clip.mp4', 'video/mp4');
    const res = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ title: 'Music', mode: 'editor', aspectRatio: '16:9', sourceAssetId: done!.body.data.id, settings: { resolution: '720p', framing: 'crop', bRollIntensity: 'none', zoomIntensity: 'off', editingIntensity: 'low', ...settings } })
      .expect(201);
    await request(app).post(`/api/projects/${res.body.data.id}/generate`).set(auth).expect(202);
    await worker.runOnce();
    return (await request(app).get(`/api/projects/${res.body.data.id}`).set(auth).expect(200)).body.data;
  }

  /** Mean volume (dB) of the 1 kHz band within [from, to] seconds of a render. */
  async function band(assetId: string, from: number, to: number): Promise<number> {
    const a = await Asset.findById(assetId);
    const { stderr } = await runFfmpeg(['-ss', String(from), '-t', String(to - from), '-i', localStorage.resolve(a!.storageKey), '-vn', '-af', 'bandpass=f=1000:width_type=h:w=60,bandpass=f=1000:width_type=h:w=60,volumedetect', '-f', 'null', '-']);
    return Number(/mean_volume:\s*(-?[\d.]+)/.exec(stderr)?.[1] ?? -200);
  }

  it('says so honestly when no licensed library is configured', async () => {
    const { auth, user } = await registerUser({ verify: true });
    await setPlan(user.defaultWorkspaceId, 'starter');
    const p = await renderBlack(auth, { musicMood: 'calm' });
    expect(p.renderStats.music).toBeNull();
    expect(p.renderStats.warnings.join(' ')).toMatch(/no licensed music library/);
  }, 120_000);

  it('mixes the licensed track in (audible even when the source has no audio) and records it', async () => {
    const { auth, user } = await registerUser({ verify: true });
    await setPlan(user.defaultWorkspaceId, 'starter');
    await installTone();
    const dir = await mkdtemp(path.join(tmpdir(), 'sis-mute-'));
    const mute = path.join(dir, 'mute.mp4');
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=25:d=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', mute]);
    const p = await renderClip(auth, await readFile(mute), { musicMood: 'calm' });
    expect(p.renderStats.music).toEqual({ title: 'Test Tone', artist: 'Lab', license: 'Test licence' });
    expect(p.outputAsset.hasAudio).toBe(true);
    expect(await band(p.outputAsset.id, 0.3, 1.2)).toBeGreaterThan(-30);
  }, 120_000);

  it('dips the music while someone speaks and brings it back when they stop', async () => {
    const { auth, user } = await registerUser({ verify: true });
    await setPlan(user.defaultWorkspaceId, 'starter');
    await installTone();
    // "Speech" (300 Hz) 0–3 s, a 0.9 s pause (short enough not to be cut), speech again 3.9–6 s.
    const dir = await mkdtemp(path.join(tmpdir(), 'sis-duck-'));
    const clip = path.join(dir, 'duck.mp4');
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=25:d=6',
      '-f', 'lavfi', '-i', "aevalsrc='if(lt(t,3)+gte(t,3.9),0.5*sin(2*PI*300*t),0)':s=48000:d=6",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip,
    ]);
    const p = await renderClip(auth, await readFile(clip), { musicMood: 'calm' });
    expect(p.renderStats.music?.title).toBe('Test Tone');
    const underSpeech = await band(p.outputAsset.id, 1.0, 2.6);
    const inPause = await band(p.outputAsset.id, 3.4, 3.85);
    console.log(`music under speech ${underSpeech} dB, in the pause ${inPause} dB`);
    expect(inPause - underSpeech).toBeGreaterThan(4); // ducked under the voice, back up in the pause
    expect(underSpeech).toBeGreaterThan(-45); // …but still audible under speech, not muted
  }, 120_000);
});
