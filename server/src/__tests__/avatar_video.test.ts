import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { FakeTts } from './fakeTts.js';
import { runFfmpeg } from '../services/video/ffmpeg.js';
import { Worker } from '../services/queue/worker.js';
import { registerNarrationJob } from '../services/audio/narrationJob.js';
import { registerRenderJob } from '../services/video/renderJob.js';
import { setTtsProvider } from '../services/ai/tts.js';
import { setLLMProvider, type LLMProvider } from '../services/ai/llm.js';
import { buildBackgroundArgs } from '../services/video/background.js';
import { buildWatermarkAss } from '../services/video/captions.js';
import { cleanScript, wordsFor, writeScript } from '../services/ai/script.js';
import { Asset } from '../models/Asset.js';
import { Project } from '../models/Project.js';
import { Workspace } from '../models/Workspace.js';
import { ConsentRecord } from '../models/ConsentRecord.js';
import { CustomVoice } from '../models/CustomVoice.js';

const worker = new Worker(1, 10);
let fake: FakeTts;
let png: Buffer;

beforeAll(async () => {
  await connectTestDb();
  registerNarrationJob();
  registerRenderJob();
  const dir = await mkdtemp(path.join(tmpdir(), 'sis-avatar-'));
  fake = new FakeTts(dir);
  const f = path.join(dir, 'bg.png');
  await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=size=800x800:rate=1:duration=1', '-frames:v', '1', f]);
  png = await readFile(f);
}, 60_000);
beforeEach(async () => {
  await resetDb();
  fake.calls = [];
  setTtsProvider(fake);
  setLLMProvider(null);
});
afterEach(() => {
  setTtsProvider(undefined);
  setLLMProvider(undefined);
});
afterAll(() => mongoose.disconnect());

const drain = async () => {
  while (await worker.runOnce(true)) {
    /* run queued jobs */
  }
};

const SETTINGS = { voiceId: 'voiceA1', resolution: '720p', bRollIntensity: 'none', musicMood: 'none', zoomIntensity: 'off' };

async function voiced(auth: Record<string, string>, extra: Record<string, unknown> = {}) {
  const p = (
    await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ title: 'Explainer', mode: 'avatar', script: 'Three habits doubled my reach. Post every day.', settings: SETTINGS, ...extra })
      .expect(201)
  ).body.data;
  await request(app).post(`/api/projects/${p.id}/narrate`).set(auth).expect(202);
  await drain();
  return p;
}

async function user(credits = 20) {
  const u = await registerUser({ verify: true });
  await Workspace.updateOne({ _id: u.user.defaultWorkspaceId }, { creditBalance: credits });
  return u;
}

describe('building blocks', () => {
  it('builds background inputs for each kind', () => {
    const base = { width: 720, height: 1280, durationSec: 4.2, audioPath: 'a.mp3', output: 'o.mp4' };
    const brand = buildBackgroundArgs({ ...base, kind: 'brand', colors: ['#7C3AED', '#0F172A'] }).join(' ');
    expect(brand).toContain('gradients=s=720x1280:c0=0x7C3AED:c1=0x0F172A');
    expect(brand).toContain('-t 4.200');
    expect(buildBackgroundArgs({ ...base, kind: 'color', colors: ['#112233', '#112233'] }).join(' ')).toContain('color=c=0x112233:s=720x1280');
    const img = buildBackgroundArgs({ ...base, kind: 'image', mediaPath: 'bg.png' });
    expect(img).toContain('-loop');
    expect(img.join(' ')).toMatch(/crop=720:1280:x='\(iw-ow\)\*t\/4\.200'/);
    expect(buildBackgroundArgs({ ...base, kind: 'video', mediaPath: 'v.mp4' })).toContain('-stream_loop');
    // Bad colours fall back instead of reaching FFmpeg.
    expect(buildBackgroundArgs({ ...base, kind: 'color', colors: ['red;x', 'red'] }).join(' ')).toContain('0x1E1B4B');
  });

  it('adds the AI disclosure with or without the watermark', () => {
    const both = buildWatermarkAss({ width: 720, height: 1280, durationSec: 5, disclosure: { text: 'AI-generated voice', corner: 'top-left' } });
    expect(both).toContain('Made with ShortsInShort');
    expect(both).toContain(',Disclose,,0,0,0,,AI-generated voice');
    const only = buildWatermarkAss({ width: 720, height: 1280, durationSec: 5, watermark: false, disclosure: { text: 'AI {x} voice', corner: 'bottom-left' } });
    expect(only).not.toContain('Made with ShortsInShort');
    expect(only).toContain('AI x voice'); // override braces stripped
  });

  it('cleans scripts and sizes them to the length', async () => {
    expect(cleanScript('## Hook\n**Stop scrolling!** [upbeat music] Here is why. #growth #tips\n\n\n\nBye')).toBe('Hook\nStop scrolling! Here is why.\n\nBye');
    expect(wordsFor(60, 'en')).toBe(150);
    expect(wordsFor(60, 'te')).toBe(126);
    let prompt = '';
    const llm: LLMProvider = {
      name: 'fake',
      async generateJson<T>(p: string) {
        prompt = p;
        return { title: 'Reach', hook: 'Stop scrolling.', script: 'Stop scrolling. *Three* habits doubled my reach. #growth' } as T;
      },
    };
    const r = await writeScript(llm, { topic: 'growing on Instagram', language: 'te', durationSec: 30, style: 'educational' });
    expect(r.script).toBe('Stop scrolling. Three habits doubled my reach.');
    expect(prompt).toContain('Telugu (Telugu script)');
    expect(prompt).toContain('about 63 words');
  });
});

describe('AI script writing API', () => {
  it('writes a script when configured and says so when not', async () => {
    const { auth } = await user();
    expect((await request(app).post('/api/ai/script').set(auth).send({ topic: 'morning routines' }).expect(503)).body.error.code).toBe('NOT_CONFIGURED');
    setLLMProvider({ name: 'fake', generateJson: async <T>() => ({ title: 'Mornings', hook: 'Wake up.', script: 'Wake up early. It changes everything.' }) as T });
    const res = await request(app).post('/api/ai/script').set(auth).send({ topic: 'morning routines', durationSec: 30, language: 'hi', style: 'vlog' }).expect(200);
    expect(res.body.data).toMatchObject({ title: 'Mornings', script: 'Wake up early. It changes everything.' });
    await request(app).post('/api/ai/script').set(auth).send({ topic: 'x' }).expect(400);
    await request(app).post('/api/ai/script').set(auth).send({ topic: 'valid topic', durationSec: 999 }).expect(400);
  });
});

describe('voiceover video render', () => {
  it('renders background + voiceover + timed captions + watermark + AI label, charging per minute', async () => {
    const { auth, user: u } = await user();
    const p = await voiced(auth);

    const est = (await request(app).get(`/api/projects/${p.id}/estimate`).set(auth).expect(200)).body.data;
    expect(est).toMatchObject({ credits: 1, resolution: '720p', resolutionAllowed: true, narrationOutdated: false });
    expect(est.sourceDurationSec).toBeGreaterThan(1.5);

    await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(202);
    await drain();
    const done = (await request(app).get(`/api/projects/${p.id}`).set(auth).expect(200)).body.data;
    expect(done.status).toBe('completed');
    expect(done.outputAsset).toMatchObject({ kind: 'render', width: 720, height: 1280, hasAudio: true });
    expect(done.renderStats).toMatchObject({ captionsAdded: true, disclosure: true, watermark: true, background: 'brand', cuts: 0, silenceRemovedSec: 0 });
    expect(done.captionLines.map((l: { text: string }) => l.text).join(' ')).toContain('habits');
    // The video is as long as the voiceover (no pause cutting).
    expect(Math.abs(done.outputAsset.durationSec - done.narrationAsset.durationSec)).toBeLessThan(0.3);
    const ws = await Workspace.findById(u.defaultWorkspaceId);
    expect(ws!.creditBalance).toBe(20 - 1 - 1); // voiceover + render
  }, 120_000);

  it('uses an uploaded background image and can switch the AI label off for library voices', async () => {
    const { auth } = await user();
    await Workspace.updateOne({}, { plan: 'creator' });
    const init = await request(app).post('/api/assets/uploads').set(auth).send({ filename: 'bg.png', contentType: 'image/png', sizeBytes: png.length, purpose: 'background' }).expect(201);
    await request(app).put(init.body.data.upload.url).set('Content-Type', 'image/png').send(png).expect(200);
    const bg = (await request(app).post(`/api/assets/${init.body.data.asset.id}/complete`).set(auth).expect(200)).body.data;
    expect(bg.kind).toBe('background_image');

    const p = await voiced(auth, { settings: { ...SETTINGS, background: 'image', disclosure: false }, backgroundAssetId: bg.id });
    expect((await request(app).get(`/api/projects/${p.id}`).set(auth).expect(200)).body.data.backgroundAsset.id).toBe(bg.id);
    await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(202);
    await drain();
    const done = (await request(app).get(`/api/projects/${p.id}`).set(auth).expect(200)).body.data;
    expect(done.status).toBe('completed');
    expect(done.renderStats).toMatchObject({ background: 'image', disclosure: false, watermark: false });
  }, 120_000);

  it('requires an up-to-date voiceover and a chosen background', async () => {
    const { auth } = await user();
    const bare = (await request(app).post('/api/projects').set(auth).send({ title: 'x', mode: 'avatar', script: 'Hello there.', settings: SETTINGS }).expect(201)).body.data;
    expect((await request(app).post(`/api/projects/${bare.id}/generate`).set(auth).expect(400)).body.error.code).toBe('NO_NARRATION');

    const p = await voiced(auth);
    await request(app).patch(`/api/projects/${p.id}`).set(auth).send({ script: 'A different script now.' }).expect(200);
    expect((await request(app).get(`/api/projects/${p.id}/estimate`).set(auth).expect(200)).body.data.narrationOutdated).toBe(true);
    expect((await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(409)).body.error.code).toBe('NARRATION_OUTDATED');

    await request(app).patch(`/api/projects/${p.id}`).set(auth).send({ script: 'Three habits doubled my reach. Post every day.', settings: { background: 'video' } }).expect(200);
    expect((await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(400)).body.error.code).toBe('NO_BACKGROUND');
    // Another workspace's asset can't be used as a background.
    const other = await user();
    const theirs = await Asset.create({ workspaceId: other.user.defaultWorkspaceId, kind: 'background_image', status: 'ready', storageKey: `x/${new Types.ObjectId()}.png`, mimeType: 'image/png' });
    await request(app).patch(`/api/projects/${p.id}`).set(auth).send({ backgroundAssetId: theirs._id.toString() }).expect(400);
  }, 60_000);

  it('always labels cloned voices and blocks renders after consent is withdrawn', async () => {
    const { auth, user: u } = await user();
    const ws = u.defaultWorkspaceId;
    const consent = await ConsentRecord.create({
      workspaceId: ws, createdBy: u.id, kind: 'voice', relationship: 'self', subjectName: 'Test Creator', subjectEmail: 'x@example.com',
      statementText: 'I agree', attestations: { rightsAndConsent: true, notPublicFigure: true, acceptsUsePolicy: true }, status: 'active', revokeTokenHash: 'h1',
    });
    await CustomVoice.create({ workspaceId: ws, createdBy: u.id, consentRecordId: consent._id, name: 'Me', status: 'ready', providerVoiceId: 'cloneZ' });
    const p = await voiced(auth, { settings: { ...SETTINGS, voiceId: 'cloneZ', disclosure: false } });
    expect((await Project.findById(p.id))!.narrationStats!.voiceId).toBe('cloneZ');

    await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(202);
    await drain();
    expect((await Project.findById(p.id))!.renderStats!.disclosure).toBe(true); // forced for cloned voices

    await ConsentRecord.updateOne({ _id: consent._id }, { status: 'revoked' });
    expect((await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(409)).body.error.code).toBe('VOICE_WITHDRAWN');
  }, 120_000);
});
