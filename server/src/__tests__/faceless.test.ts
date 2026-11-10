import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { copyFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { FakeTts } from './fakeTts.js';
import { runFfmpeg } from '../services/video/ffmpeg.js';
import { Worker } from '../services/queue/worker.js';
import { registerNarrationJob } from '../services/audio/narrationJob.js';
import { registerRenderJob } from '../services/video/renderJob.js';
import { registerPlanScenesJob } from '../services/faceless/planJob.js';
import { setTtsProvider } from '../services/ai/tts.js';
import { setLLMProvider, type LLMProvider } from '../services/ai/llm.js';
import { setStockProvider, type StockClip, type StockVideoProvider } from '../services/ai/stock.js';
import { fallbackQuery, planSceneQueries, sceneTimings, splitScenes } from '../services/faceless/scenes.js';
import { buildScenesArgs } from '../services/video/background.js';
import { Asset } from '../models/Asset.js';
import { CreditTransaction } from '../models/CreditTransaction.js';
import { Project } from '../models/Project.js';
import { Workspace } from '../models/Workspace.js';

const worker = new Worker(1, 10);
let tts: FakeTts;
let clipFile: string;

/** Stand-in stock library: every query returns clips tagged with its words; downloads a real 2 s clip. */
class FakeStock implements StockVideoProvider {
  readonly name = 'fake-stock';
  readonly license = 'Test licence';
  searches: string[] = [];
  downloads = 0;
  async searchVideos(query: string): Promise<StockClip[]> {
    this.searches.push(query);
    const slug = query.replace(/\s+/g, '-');
    return [1, 2, 3].map((n) => ({
      id: `${slug}-${n}`,
      provider: 'fake-stock',
      downloadUrl: `https://cdn.example.com/${slug}-${n}.mp4`,
      pageUrl: `https://stock.example.com/${slug}-${n}`,
      author: `author${n}`,
      width: 1280,
      height: 720,
      durationSec: 20,
      tags: query.split(/\s+/),
      thumbnailUrl: `https://cdn.example.com/${slug}-${n}.jpg`,
    }));
  }
  async download(_clip: StockClip, dest: string) {
    this.downloads++;
    await copyFile(clipFile, dest);
  }
}
let stock: FakeStock;

beforeAll(async () => {
  await connectTestDb();
  registerNarrationJob();
  registerRenderJob();
  registerPlanScenesJob();
  const dir = await mkdtemp(path.join(tmpdir(), 'sis-faceless-'));
  tts = new FakeTts(dir);
  clipFile = path.join(dir, 'clip.mp4');
  await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clipFile]);
}, 60_000);
beforeEach(async () => {
  await resetDb();
  stock = new FakeStock();
  setTtsProvider(tts);
  setStockProvider(stock);
  setLLMProvider(null);
});
afterEach(() => {
  setTtsProvider(undefined);
  setStockProvider(undefined);
  setLLMProvider(undefined);
});
afterAll(() => mongoose.disconnect());

const drain = async () => {
  while (await worker.runOnce(true)) {
    /* run queued jobs */
  }
};

const SCRIPT = 'Coffee changed how cities wake up. Every morning, millions of people line up at small cafes. The ritual matters more than the caffeine.';
const SETTINGS = { voiceId: 'voiceA1', resolution: '720p', musicMood: 'none', zoomIntensity: 'off' };

async function setup(script = SCRIPT) {
  const u = await registerUser({ verify: true });
  await Workspace.updateOne({ _id: u.user.defaultWorkspaceId }, { creditBalance: 30 });
  const p = (await request(app).post('/api/projects').set(u.auth).send({ title: 'Coffee', mode: 'faceless', topic: 'coffee culture', script, settings: SETTINGS }).expect(201)).body.data;
  return { ...u, p };
}

describe('scene planning helpers', () => {
  it('splits a script into ordered scenes without losing words', () => {
    const long = 'This is a much longer sentence, with several clauses, that keeps going and going well past the comfortable length of a single scene for any viewer.';
    const scenes = splitScenes(`${SCRIPT} ${long} Short. Done.`);
    const joined = scenes.map((s) => s.text).join(' ').split(/\s+/);
    expect(joined).toEqual(`${SCRIPT} ${long} Short. Done.`.split(/\s+/));
    for (const s of scenes) expect(s.text.split(/\s+/).length).toBeLessThanOrEqual(20);
    expect(scenes.length).toBeGreaterThanOrEqual(3);
    // Devanagari full stops split too.
    expect(splitScenes('पहला वाक्य यहाँ है और यह काफी लंबा है। दूसरा वाक्य भी यहाँ है और यह भी लंबा है।', 'hi').length).toBe(2);
    expect(splitScenes('   ')).toEqual([]);
  });

  it('times scenes from the voiceover words, or by length when timings are missing', () => {
    const scenes = [{ text: 'one two three' }, { text: 'four five' }, { text: 'six' }];
    const words = [0, 1, 2, 3, 4, 5].map((i) => ({ start: i, end: i + 0.8 }));
    expect(sceneTimings(scenes, words, 6.5)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 5 },
      { start: 5, end: 6.5 },
    ]);
    const prop = sceneTimings([{ text: 'aaaa' }, { text: 'aaaa' }], [], 10);
    expect(prop).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
    ]);
  });

  it('asks the LLM only for searches and falls back to keywords', async () => {
    expect(fallbackQuery('Every morning, millions of people line up at small cafes.')).toBe('millions morning');
    let prompt = '';
    const llm: LLMProvider = {
      name: 'fake',
      async generateJson<T>(p: string) {
        prompt = p;
        return { scenes: [{ index: 0, queries: ['city sunrise', 'coffee <b>cup</b>'] }, { index: 9, queries: ['ignored'] }] } as T;
      },
    };
    const q = await planSceneQueries(llm, [{ text: 'Coffee changed how cities wake up.' }, { text: 'Every morning, millions of people line up.' }], { language: 'en', topic: 'coffee' });
    expect(q[0]).toEqual(['city sunrise', 'coffee b cup b']);
    expect(q[1]).toEqual(['millions morning']);
    expect(prompt).toContain('1: Every morning');
  });

  it('builds the scene assembly command', () => {
    const args = buildScenesArgs({ width: 720, height: 1280, scenes: [{ path: 'a.mp4', durationSec: 2.5 }, { path: 'b.mp4', durationSec: 3 }], audioPath: 'v.mp3', output: 'o.mp4' }).join(' ');
    expect(args).toContain('-stream_loop -1 -t 2.500 -i a.mp4');
    expect(args).toContain('concat=n=2:v=1:a=0');
    expect(args).toContain('-map 2:a:0');
    expect(args).toContain('-t 5.500');
  });
});

describe('faceless video flow', () => {
  it('plans scenes for free, then renders clips timed to the voiceover with attribution', async () => {
    const { auth, p, user } = await setup();
    await request(app).post(`/api/projects/${p.id}/narrate`).set(auth).expect(202);
    await drain();

    await request(app).post(`/api/projects/${p.id}/scenes/plan`).set(auth).expect(202);
    await drain();
    const planned = (await request(app).get(`/api/projects/${p.id}`).set(auth).expect(200)).body.data;
    expect(planned.status).toBe('completed'); // back to its previous state (the voiceover had finished)
    expect(planned.scenes.length).toBeGreaterThanOrEqual(2);
    expect(planned.scenes.map((s: { text: string }) => s.text).join(' ')).toBe(SCRIPT);
    const ids = planned.scenes.map((s: { clip: { id: string } }) => s.clip.id);
    expect(new Set(ids).size).toBe(ids.length); // no clip reused
    expect(planned.scenes[0].clip.downloadUrl).toBeUndefined(); // never sent to the browser
    expect(planned.scenes[0].clip.thumbnailUrl).toMatch(/^https:/);
    expect(await CreditTransaction.countDocuments({ workspaceId: user.defaultWorkspaceId, type: 'consume' })).toBe(1); // only the voiceover

    const est = (await request(app).get(`/api/projects/${p.id}/estimate`).set(auth).expect(200)).body.data;
    expect(est).toMatchObject({ credits: 1, narrationOutdated: false, sceneCount: planned.scenes.length });
    await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(202);
    await drain();
    const done = (await request(app).get(`/api/projects/${p.id}`).set(auth).expect(200)).body.data;
    expect(done.status).toBe('completed');
    expect(done.outputAsset).toMatchObject({ width: 720, height: 1280, hasAudio: true });
    expect(Math.abs(done.outputAsset.durationSec - done.narrationAsset.durationSec)).toBeLessThan(0.4);
    expect(done.renderStats.sceneCount).toBe(planned.scenes.length);
    expect(done.renderStats.broll).toHaveLength(planned.scenes.length);
    expect(done.renderStats.broll[0]).toMatchObject({ provider: 'fake-stock', author: expect.any(String), start: 0 });
    expect(done.renderStats.captionsAdded).toBe(true);
    expect(stock.downloads).toBe(planned.scenes.length);
  }, 180_000);

  it('lets the user search a scene and pick another clip', async () => {
    const { auth, p } = await setup();
    await request(app).post(`/api/projects/${p.id}/scenes/plan`).set(auth).expect(202);
    await drain();
    const res = await request(app).post(`/api/projects/${p.id}/scenes/0/search`).set(auth).send({ query: 'sunrise skyline' }).expect(200);
    expect(res.body.meta.found).toBe(3);
    expect(res.body.data.scenes[0].queries[0]).toBe('sunrise skyline');
    const pick = res.body.data.scenes[0].candidates[1].id;
    const after = await request(app).patch(`/api/projects/${p.id}/scenes/0`).set(auth).send({ clipId: pick }).expect(200);
    expect(after.body.data.scenes[0].clip.id).toBe(pick);
    expect((await request(app).patch(`/api/projects/${p.id}/scenes/0`).set(auth).send({ clipId: 'nope' }).expect(400)).body.error.code).toBe('INVALID_CLIP');
    await request(app).post(`/api/projects/${p.id}/scenes/99/search`).set(auth).send({ query: 'xx yy' }).expect(404);
  }, 60_000);

  it('blocks renders until voiceover and scenes match the current script', async () => {
    const { auth, p } = await setup();
    expect((await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(400)).body.error.code).toBe('NO_NARRATION');
    await request(app).post(`/api/projects/${p.id}/narrate`).set(auth).expect(202);
    await drain();
    expect((await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(400)).body.error.code).toBe('NO_SCENES');
    await request(app).post(`/api/projects/${p.id}/scenes/plan`).set(auth).expect(202);
    await drain();
    await request(app).patch(`/api/projects/${p.id}`).set(auth).send({ script: `${SCRIPT} One more line.` }).expect(200);
    expect((await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(409)).body.error.code).toBe('SCENES_OUTDATED');
    // A scene with no clip is caught too.
    await Project.updateOne({ _id: p.id }, { script: SCRIPT, 'scenes.1.clip': null });
    expect((await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(400)).body.error.code).toBe('SCENE_WITHOUT_CLIP');
    setStockProvider(null);
    expect((await request(app).post(`/api/projects/${p.id}/scenes/plan`).set(auth).expect(503)).body.error.code).toBe('NOT_CONFIGURED');
    expect((await request(app).get('/api/meta').expect(200)).body.data.features.facelessCreator).toBe(false);
  }, 60_000);

  it('keeps scenes private to the workspace and only for faceless projects', async () => {
    const { p } = await setup();
    const other = await registerUser({ verify: true });
    await request(app).post(`/api/projects/${p.id}/scenes/plan`).set(other.auth).expect(404);
    await request(app).post(`/api/projects/${p.id}/scenes/0/search`).set(other.auth).send({ query: 'coffee cup' }).expect(404);
    const editor = (await request(app).post('/api/projects').set(other.auth).send({ title: 'E', mode: 'editor' }).expect(201)).body.data;
    expect((await request(app).post(`/api/projects/${editor.id}/scenes/plan`).set(other.auth).expect(400)).body.error.code).toBe('WRONG_MODE');
    expect(await Asset.countDocuments()).toBe(0);
  });
});
