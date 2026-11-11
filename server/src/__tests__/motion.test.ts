import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { FakeTts } from './fakeTts.js';
import { probe, runFfmpeg } from '../services/video/ffmpeg.js';
import { Worker } from '../services/queue/worker.js';
import { registerNarrationJob } from '../services/audio/narrationJob.js';
import { registerRenderJob } from '../services/video/renderJob.js';
import { registerPlanScenesJob } from '../services/faceless/planJob.js';
import { setTtsProvider } from '../services/ai/tts.js';
import { setLLMProvider, type LLMProvider } from '../services/ai/llm.js';
import { setStockProvider } from '../services/ai/stock.js';
import { fallbackMotionScene, parseMotionScene, planMotionScenes } from '../services/faceless/motion.js';
import { motionTheme, remotionRenderer, setMotionRenderer, type MotionRenderInput } from '../services/video/motionRender.js';
import { BrandKit } from '../models/BrandKit.js';
import { Project } from '../models/Project.js';
import { Workspace } from '../models/Workspace.js';

const worker = new Worker(1, 10);
let tts: FakeTts;
let dir: string;
const renders: MotionRenderInput[] = [];

/** Stand-in renderer: a real silent MP4 of the requested size and total length (no Chrome). */
async function fakeRenderer(input: MotionRenderInput) {
  renders.push(input);
  const frames = input.scenes.reduce((t, s) => t + s.durationInFrames, 0);
  await runFfmpeg(['-f', 'lavfi', '-i', `color=c=0x1E1B4B:s=${input.width}x${input.height}:r=30:d=${(frames / 30).toFixed(3)}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', input.output]);
}

beforeAll(async () => {
  await connectTestDb();
  registerNarrationJob();
  registerRenderJob();
  registerPlanScenesJob();
  dir = await mkdtemp(path.join(tmpdir(), 'sis-motion-'));
  tts = new FakeTts(dir);
}, 60_000);
beforeEach(async () => {
  await resetDb();
  renders.length = 0;
  setTtsProvider(tts);
  setStockProvider(null); // Motion Explainer needs no stock footage
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
    /* run queued jobs */
  }
};

const SCRIPT = 'What is generative AI? It learns patterns from millions of examples. Then it creates new text, images and videos.';

async function motionProject() {
  const u = await registerUser({ verify: true });
  await Workspace.updateOne({ _id: u.user.defaultWorkspaceId }, { creditBalance: 30 });
  const p = (
    await request(app)
      .post('/api/projects')
      .set(u.auth)
      .send({ title: 'Gen AI', mode: 'faceless', topic: 'generative AI', script: SCRIPT, settings: { voiceId: 'voiceA1', resolution: '720p', musicMood: 'none', zoomIntensity: 'off', facelessStyle: 'motion' } })
      .expect(201)
  ).body.data;
  await request(app).post(`/api/projects/${p.id}/narrate`).set(u.auth).expect(202);
  await drain();
  return { ...u, p };
}

describe('motion scene contract', () => {
  it('validates templates strictly', () => {
    expect(parseMotionScene({ template: 'stat', params: { value: '73%', label: 'of creators' } })).toBeTruthy();
    expect(parseMotionScene({ template: 'cards', params: { cards: [{ icon: 'image', label: 'Images' }, { icon: 'video', label: 'Videos' }] } })).toBeTruthy();
    expect(parseMotionScene({ template: 'cards', params: { cards: [{ icon: 'not-an-icon', label: 'x' }, { icon: 'video', label: 'y' }] } })).toBeNull();
    expect(parseMotionScene({ template: 'bullets', params: { items: ['only one'] } })).toBeNull();
    expect(parseMotionScene({ template: 'title', params: { headline: 'x'.repeat(61) } })).toBeNull();
    expect(parseMotionScene({ template: 'title', params: { headline: 'ok', script: 'alert(1)' } })).toBeNull(); // no extra fields
    expect(parseMotionScene({ template: 'html', params: {} })).toBeNull();
  });

  it('falls back to safe text scenes', () => {
    expect(fallbackMotionScene('What is generative AI? More words here.', 0)).toEqual({ template: 'title', params: { headline: 'What is generative AI?' } });
    const long = fallbackMotionScene(`${'word '.repeat(40)}end.`, 3);
    expect(long.template).toBe('statement');
    expect((long.params as { text: string }).text.length).toBeLessThanOrEqual(120);
    expect((long.params as { text: string }).text.endsWith('…')).toBe(true);
  });

  it('keeps valid AI choices, trims extra fields and replaces invalid ones', async () => {
    let prompt = '';
    const llm: LLMProvider = {
      name: 'fake',
      async generateJson<T>(p: string) {
        prompt = p;
        return {
          scenes: [
            { index: 0, template: 'title', params: JSON.stringify({ eyebrow: 'What is', headline: 'Generative AI?', items: ['ignored'] }) },
            { index: 1, template: 'cards', params: JSON.stringify({ cards: [{ icon: 'banana', label: 'x' }, { icon: 'brain', label: 'y' }] }) },
            { index: 2, template: 'process', params: JSON.stringify({ steps: [{ icon: 'message', label: 'Prompt' }, { icon: 'brain', label: 'Model' }, { icon: 'sparkles', label: 'Result' }] }) },
            { index: 1, template: 'stat', params: '{not json' },
            { index: 7, template: 'cta', params: JSON.stringify({ headline: 'x', action: 'y' }) },
          ],
        } as T;
      },
    };
    const r = await planMotionScenes(llm, [{ text: 'a' }, { text: 'It learns patterns.' }, { text: 'c' }], { language: 'te', topic: 'AI' });
    expect(r.scenes[0]).toEqual({ template: 'title', params: { eyebrow: 'What is', headline: 'Generative AI?' } });
    expect(r.scenes[1]).toEqual({ template: 'statement', params: { text: 'It learns patterns.' } }); // bad icon → fallback
    expect(r.scenes[2]!.template).toBe('process');
    expect(r.fallbacks).toBe(1);
    expect(prompt).toContain('language with code "te"');
    expect(prompt).toContain('fitness');
  });

  it('builds a readable dark theme from brand colours', () => {
    const t = motionTheme('#FF0000', '#00FF00');
    expect(t.primary).toBe('#FF0000');
    expect(t.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseInt(t.background.slice(1, 3), 16)).toBeLessThan(40);
    expect(motionTheme('red', 'blue').primary).toBe('#7C3AED');
  });
});

describe('Motion Explainer videos', () => {
  it('plans animated scenes without stock footage and renders them timed to the voiceover', async () => {
    const { auth, p, user } = await motionProject();
    await BrandKit.create({ workspaceId: user.defaultWorkspaceId, primaryColor: '#E11D48', secondaryColor: '#F59E0B' });
    await request(app).post(`/api/projects/${p.id}/scenes/plan`).set(auth).expect(202);
    await drain();
    const planned = (await request(app).get(`/api/projects/${p.id}`).set(auth).expect(200)).body.data;
    expect(planned.scenesPlannedWith).toBe('keywords'); // no AI configured → safe text scenes
    expect(planned.scenes[0].motion).toMatchObject({ template: 'title' });
    expect(planned.scenes.every((s: { motion: unknown }) => parseMotionScene(s.motion))).toBe(true);

    const est = (await request(app).get(`/api/projects/${p.id}/estimate`).set(auth).expect(200)).body.data;
    expect(est.credits).toBe(2); // Motion Explainer: 2 per started 30 s
    await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(202);
    await drain();
    const done = (await request(app).get(`/api/projects/${p.id}`).set(auth).expect(200)).body.data;
    expect(done.status).toBe('completed');
    expect(done.renderStats).toMatchObject({ facelessStyle: 'motion', sceneCount: planned.scenes.length, captionsAdded: true });
    expect(done.renderStats.broll).toHaveLength(0);
    expect(done.renderStats.sfxCount).toBeGreaterThan(0); // effects follow the animations
    expect(done.renderStats.sceneTransition).toBeNull();
    expect(renders).toHaveLength(1);
    expect(renders[0]!.theme.primary).toBe('#E11D48');
    expect(renders[0]).toMatchObject({ width: 720, height: 1280 });
    const frames = renders[0]!.scenes.reduce((t, s) => t + s.durationInFrames, 0);
    expect(Math.abs(frames / 30 - done.narrationAsset.durationSec)).toBeLessThan(0.2);
    expect(Math.abs(done.outputAsset.durationSec - done.narrationAsset.durationSec)).toBeLessThan(0.4);
  }, 120_000);

  it('edits, re-designs and splits motion scenes', async () => {
    const { auth, p } = await motionProject();
    await request(app).post(`/api/projects/${p.id}/scenes/plan`).set(auth).expect(202);
    await drain();
    const stat = { template: 'stat', params: { value: '10x', label: 'faster content' } };
    const edited = (await request(app).patch(`/api/projects/${p.id}/scenes/1`).set(auth).send({ motion: stat }).expect(200)).body.data;
    expect(edited.scenes[1].motion).toEqual(stat);
    await request(app).patch(`/api/projects/${p.id}/scenes/1`).set(auth).send({ motion: { template: 'stat', params: { value: '10x' } } }).expect(400);

    setLLMProvider({ name: 'fake', generateJson: async <T>() => ({ scenes: [{ index: 0, template: 'orbit', params: JSON.stringify({ centerIcon: 'cpu', label: 'One model', icons: ['file', 'image', 'video'] }) }] }) as T });
    const re = await request(app).post(`/api/projects/${p.id}/scenes/1/replan`).set(auth).expect(200);
    expect(re.body.meta.plannedWith).toBe('ai');
    expect(re.body.data.scenes[1].motion.template).toBe('orbit');

    const split = (await request(app).post(`/api/projects/${p.id}/scenes/1/split`).set(auth).send({ atWord: 2 }).expect(200)).body.data;
    expect(split.scenes[2].motion.template).toBe('statement');

    await Project.updateOne({ _id: p.id }, { 'scenes.0.motion': null });
    expect((await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(400)).body.error.code).toBe('SCENE_WITHOUT_ANIMATION');
  }, 60_000);
});

describe('real Remotion render', () => {
  it('renders the composition in headless Chrome', async () => {
    const out = path.join(dir, 'real.mp4');
    await remotionRenderer({
      scenes: [
        { template: 'title', params: { eyebrow: 'Test', headline: 'హలో Motion' }, durationInFrames: 15 },
        { template: 'stat', params: { value: '73%', label: 'counted up' }, durationInFrames: 15 },
      ],
      theme: motionTheme(),
      width: 360,
      height: 640,
      output: out,
    });
    const info = await probe(out);
    expect(info.video).toMatchObject({ width: 360, height: 640 });
    expect(info.durationSec).toBeGreaterThan(0.9);
  }, 300_000);
});
