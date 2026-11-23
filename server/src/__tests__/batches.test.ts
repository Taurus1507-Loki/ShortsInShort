import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { FakeTts } from './fakeTts.js';
import { runFfmpeg } from '../services/video/ffmpeg.js';
import { Worker } from '../services/queue/worker.js';
import { registerNarrationJob } from '../services/audio/narrationJob.js';
import { registerRenderJob } from '../services/video/renderJob.js';
import { registerPlanScenesJob } from '../services/faceless/planJob.js';
import { registerAutopilot } from '../services/batch/autopilot.js';
import { setTtsProvider } from '../services/ai/tts.js';
import { setLLMProvider } from '../services/ai/llm.js';
import { setStockProvider } from '../services/ai/stock.js';
import { setMotionRenderer, type MotionRenderInput } from '../services/video/motionRender.js';
import { Workspace } from '../models/Workspace.js';
import { CreditTransaction } from '../models/CreditTransaction.js';

const worker = new Worker(1, 10);
let tts: FakeTts;

/** Stand-in Motion renderer: a real silent MP4 of the requested size and length (no Chrome). */
async function fakeRenderer(input: MotionRenderInput) {
  const frames = input.scenes.reduce((t, s) => t + s.durationInFrames, 0);
  await runFfmpeg(['-f', 'lavfi', '-i', `color=c=0x1E1B4B:s=${input.width}x${input.height}:r=30:d=${(frames / 30).toFixed(3)}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', input.output]);
}

beforeAll(async () => {
  await connectTestDb();
  registerNarrationJob();
  registerRenderJob();
  registerPlanScenesJob();
  registerAutopilot();
  tts = new FakeTts(await mkdtemp(path.join(tmpdir(), 'sis-batch-')));
}, 60_000);
beforeEach(async () => {
  await resetDb();
  setTtsProvider(tts);
  setStockProvider(null);
  setLLMProvider(null);
  setMotionRenderer(fakeRenderer);
});
afterEach(() => {
  setTtsProvider(undefined);
  setStockProvider(undefined);
  setLLMProvider(undefined);
  setMotionRenderer(undefined);
});
afterAll(() => mongoose.disconnect());

const drain = async () => {
  while (await worker.runOnce(true)) {
    /* run queued jobs, including the steps autopilot starts */
  }
};

const SCRIPTS = [
  'What is generative AI? It learns patterns from millions of examples. Then it creates new text, images and videos.',
  'Sleep matters. Keep the same bedtime every day. Put your phone away before bed. You will feel the difference in a week.',
];
const body = (overrides: Record<string, unknown> = {}) => ({
  name: 'November tips',
  templateId: 'doctor-health-tip',
  aspectRatio: '9:16',
  style: 'educational',
  settings: { voiceId: 'voiceA1', resolution: '720p', musicMood: 'none', zoomIntensity: 'off', facelessStyle: 'motion' },
  videos: SCRIPTS.map((script, i) => ({ title: `Tip ${i + 1}`, script })),
  ...overrides,
});

async function user(credits: number) {
  const u = await registerUser({ verify: true });
  await Workspace.updateOne({ _id: u.user.defaultWorkspaceId }, { creditBalance: credits });
  return u;
}
const balance = async (auth: Record<string, string>) => (await request(app).get('/api/auth/me').set(auth)).body.data.workspace.creditBalance as number;

describe('batch create', () => {
  it('prices a batch, then voices, plans and exports every video on its own', async () => {
    const { auth } = await user(100);
    const est = (await request(app).post('/api/batches/estimate').set(auth).send(body()).expect(200)).body.data;
    expect(est.videos).toHaveLength(2);
    expect(est.videos[0]).toMatchObject({ narration: 2, export: 5, total: 7 });
    expect(est).toMatchObject({ total: 14, balance: 100 });

    const created = (await request(app).post('/api/batches').set(auth).send(body()).expect(201)).body.data;
    expect(created.started).toBe(2);
    await drain();

    const detail = (await request(app).get(`/api/batches/${created.batch.id}`).set(auth).expect(200)).body.data;
    expect(detail.projects.map((p: { title: string }) => p.title)).toEqual(['Tip 1', 'Tip 2']);
    for (const p of detail.projects) {
      expect(p).toMatchObject({ mode: 'faceless', status: 'completed', batchId: created.batch.id, autopilot: { state: 'done', error: null } });
      expect(p.outputAssetId).toBeTruthy();
      expect(p.settings.facelessStyle).toBe('motion');
    }
    // Each step was charged like the step pages charge it: voiceover, then export (scene planning is free).
    const notes = (await CreditTransaction.find({ type: 'consume' }).lean()).map((t) => t.note.split(':')[0]).sort();
    expect(notes).toEqual(['Render (batch)', 'Render (batch)', 'Voiceover (batch)', 'Voiceover (batch)']);
    expect(await balance(auth)).toBe(100 - 14);

    const list = (await request(app).get('/api/batches').set(auth).expect(200)).body.data;
    expect(list[0]).toMatchObject({ name: 'November tips', videos: 2, done: 2, stopped: 0 });
  }, 180_000);

  it('refuses a batch you cannot afford, and checks the scripts', async () => {
    const { auth } = await user(10);
    const res = await request(app).post('/api/batches').set(auth).send(body()).expect(402);
    expect(res.body.error.message).toMatch(/needs about 14 credits/);
    expect((await request(app).get('/api/batches').set(auth).expect(200)).body.data).toHaveLength(0);
    await request(app).post('/api/batches/estimate').set(auth).send(body({ videos: [] })).expect(400);
    await request(app).post('/api/batches/estimate').set(auth).send(body({ videos: [{ script: 'Too short.' }] })).expect(400);
    await request(app).post('/api/batches/estimate').set(auth).send(body({ videos: Array.from({ length: 31 }, () => ({ script: SCRIPTS[0] })) })).expect(400);
    await request(app).post('/api/batches/estimate').set(auth).send(body({ settings: { ...body().settings, voiceId: 'nope' } })).expect(400);
  });

  it('stops only the video whose next step cannot start, with a note saying what to do', async () => {
    const { auth } = await user(100);
    // Stock footage that finds nothing: scenes are planned without clips.
    setStockProvider({ name: 'empty', license: 'test', async searchVideos() { return []; }, async download() { throw new Error('no'); } });
    const created = (await request(app).post('/api/batches').set(auth).send(body({ settings: { ...body().settings, facelessStyle: 'stock' }, videos: [{ script: SCRIPTS[0] }] })).expect(201)).body.data;
    await drain();
    const [p] = (await request(app).get(`/api/batches/${created.batch.id}`).set(auth).expect(200)).body.data.projects;
    expect(p.autopilot.state).toBe('stopped');
    expect(p.autopilot.error).toMatch(/No stock clip was found for scene 1/);
    expect(p.title).toBe('November tips #1');
    expect(await balance(auth)).toBe(100 - 2); // only the voiceover was charged
  }, 120_000);

  it('keeps batches private to their workspace', async () => {
    const a = await user(100);
    const created = (await request(app).post('/api/batches').set(a.auth).send(body({ videos: [{ script: SCRIPTS[0] }] })).expect(201)).body.data;
    const b = await user(100);
    await request(app).get(`/api/batches/${created.batch.id}`).set(b.auth).expect(404);
    expect((await request(app).get('/api/batches').set(b.auth).expect(200)).body.data).toHaveLength(0);
  });
});
