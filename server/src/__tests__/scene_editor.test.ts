import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
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
import { scriptFromScenes, splitSceneText } from '../services/faceless/scenes.js';
import { buildScenesArgs } from '../services/video/background.js';
import { buildWatermarkAss } from '../services/video/captions.js';
import { Project } from '../models/Project.js';
import { Workspace } from '../models/Workspace.js';

const worker = new Worker(1, 10);
let tts: FakeTts;
let clipFile: string;
let png: Buffer;

class FakeStock implements StockVideoProvider {
  readonly name = 'fake-stock';
  readonly license = 'Test licence';
  downloads = 0;
  async searchVideos(query: string): Promise<StockClip[]> {
    const slug = query.replace(/\s+/g, '-');
    return [1, 2, 3, 4].map((n) => ({
      id: `${slug}-${n}`,
      provider: 'fake-stock',
      downloadUrl: `https://cdn.example.com/${slug}-${n}.mp4`,
      pageUrl: `https://stock.example.com/${slug}-${n}`,
      author: `author${n}`,
      width: 1280,
      height: 720,
      durationSec: 20,
      tags: query.split(/\s+/),
      thumbnailUrl: null,
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
  const dir = await mkdtemp(path.join(tmpdir(), 'sis-sceneed-'));
  tts = new FakeTts(dir);
  clipFile = path.join(dir, 'clip.mp4');
  await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clipFile]);
  const img = path.join(dir, 'still.png');
  await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=size=800x800:rate=1:duration=1', '-frames:v', '1', img]);
  png = await readFile(img);
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

const SCRIPT = 'Coffee changed how cities wake up every single day. Millions of people line up at small cafes before work. The ritual matters more than the caffeine itself.';

async function planned() {
  const u = await registerUser({ verify: true });
  await Workspace.updateOne({ _id: u.user.defaultWorkspaceId }, { creditBalance: 40 });
  const p = (
    await request(app)
      .post('/api/projects')
      .set(u.auth)
      .send({ title: 'Coffee', mode: 'faceless', script: SCRIPT, settings: { voiceId: 'voiceA1', resolution: '720p', musicMood: 'none', zoomIntensity: 'off' } })
      .expect(201)
  ).body.data;
  await request(app).post(`/api/projects/${p.id}/narrate`).set(u.auth).expect(202);
  await drain();
  await request(app).post(`/api/projects/${p.id}/scenes/plan`).set(u.auth).expect(202);
  await drain();
  const project = (await request(app).get(`/api/projects/${p.id}`).set(u.auth).expect(200)).body.data;
  return { ...u, p: project };
}

const get = async (auth: Record<string, string>, id: string) => (await request(app).get(`/api/projects/${id}`).set(auth).expect(200)).body.data;
const outdated = async (auth: Record<string, string>, id: string) => (await request(app).get(`/api/projects/${id}/estimate`).set(auth).expect(200)).body.data.narrationOutdated;

describe('scene editing helpers', () => {
  it('splits scene text and rebuilds the script', () => {
    expect(splitSceneText('one two three four', 1)).toEqual(['one', 'two three four']);
    expect(() => splitSceneText('one two', 2)).toThrow();
    expect(() => splitSceneText('one two', 0)).toThrow();
    expect(scriptFromScenes([{ text: ' a b ' }, { text: '' }, { text: 'c' }])).toBe('a b c');
  });

  it('pans still images and burns on-screen titles', () => {
    const args = buildScenesArgs({ width: 720, height: 1280, scenes: [{ path: 'a.png', durationSec: 2, image: true }, { path: 'b.png', durationSec: 2, image: true }], audioPath: 'v.mp3', output: 'o.mp4' }).join(' ');
    expect(args).toContain('-loop 1 -framerate 30 -t 2.000 -i a.png');
    expect(args).toContain("x='(iw-ow)*t/2.000'");
    expect(args).toContain("x='(iw-ow)*(1-t/2.000)'"); // alternating direction
    const ass = buildWatermarkAss({ width: 720, height: 1280, durationSec: 6, watermark: false, titles: [{ start: 1, end: 3, text: 'Morning {ritual}' }] });
    expect(ass).toContain('Style: Title,');
    expect(ass).toMatch(/Dialogue: 2,0:00:01\.00,0:00:03\.00,Title,,0,0,0,,\{\\fad\(200,200\)\}Morning ritual/);
  });
});

describe('scene editor', () => {
  it('splits and merges scenes without invalidating the voiceover', async () => {
    const { auth, p } = await planned();
    const before = p.scenes.length;
    const split = (await request(app).post(`/api/projects/${p.id}/scenes/0/split`).set(auth).send({ atWord: 3 }).expect(200)).body.data;
    expect(split.scenes).toHaveLength(before + 1);
    expect(split.scenes[0].text.split(' ')).toHaveLength(3);
    expect(split.scenes[1].clip.id).not.toBe(split.scenes[0].clip.id);
    expect(split.script).toBe(SCRIPT);
    expect(split.scenesOutdated).toBe(false);
    expect(await outdated(auth, p.id)).toBe(false);

    const merged = (await request(app).post(`/api/projects/${p.id}/scenes/0/merge`).set(auth).expect(200)).body.data;
    expect(merged.scenes).toHaveLength(before);
    expect(merged.scenes.map((s: { text: string }) => s.text).join(' ')).toBe(SCRIPT);
    expect((await request(app).post(`/api/projects/${p.id}/scenes/${before - 1}/merge`).set(auth).expect(400)).body.error.code).toBe('INVALID_MERGE');
    expect((await request(app).post(`/api/projects/${p.id}/scenes/0/split`).set(auth).send({ atWord: 999 }).expect(400)).body.error.code).toBe('INVALID_SPLIT');
  }, 60_000);

  it('moving or rewording a scene rewrites the script and asks for a new voiceover', async () => {
    const { auth, p } = await planned();
    const moved = (await request(app).post(`/api/projects/${p.id}/scenes/move`).set(auth).send({ from: 0, to: p.scenes.length - 1 }).expect(200)).body.data;
    expect(moved.script.startsWith(p.scenes[1].text)).toBe(true);
    expect(moved.scenesOutdated).toBe(false);
    expect(await outdated(auth, p.id)).toBe(true);
    expect((await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(409)).body.error.code).toBe('NARRATION_OUTDATED');

    const reworded = (await request(app).patch(`/api/projects/${p.id}/scenes/0`).set(auth).send({ text: 'A brand new opening line.' }).expect(200)).body.data;
    expect(reworded.scenes[0].text).toBe('A brand new opening line.');
    expect(reworded.script.startsWith('A brand new opening line.')).toBe(true);
    await request(app).patch(`/api/projects/${p.id}/scenes/0`).set(auth).send({ text: 'x'.repeat(1001) }).expect(400);
    await request(app).patch(`/api/projects/${p.id}/scenes/0`).set(auth).send({ text: 'a', overlayText: 'b' }).expect(400); // one change at a time
  }, 60_000);

  it('renders own images with motion, on-screen text, and credits only stock clips', async () => {
    const { auth, p } = await planned();
    const init = await request(app).post('/api/assets/uploads').set(auth).send({ filename: 'still.png', contentType: 'image/png', sizeBytes: png.length, purpose: 'background' }).expect(201);
    await request(app).put(init.body.data.upload.url).set('Content-Type', 'image/png').send(png).expect(200);
    const img = (await request(app).post(`/api/assets/${init.body.data.asset.id}/complete`).set(auth).expect(200)).body.data;

    const withImg = (await request(app).patch(`/api/projects/${p.id}/scenes/0`).set(auth).send({ assetId: img.id }).expect(200)).body.data;
    expect(withImg.scenes[0]).toMatchObject({ assetId: img.id, assetType: 'image' });
    await request(app).patch(`/api/projects/${p.id}/scenes/1`).set(auth).send({ overlayText: 'Morning ritual' }).expect(200);

    await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(202);
    await drain();
    const done = await get(auth, p.id);
    expect(done.status).toBe('completed');
    expect(done.renderStats).toMatchObject({ sceneCount: p.scenes.length, titleCount: 1 });
    expect(done.renderStats.broll).toHaveLength(p.scenes.length - 1); // own image needs no credit
    expect(stock.downloads).toBe(p.scenes.length - 1);

    // Picking a stock clip again switches the scene back to stock.
    const back = (await request(app).patch(`/api/projects/${p.id}/scenes/0`).set(auth).send({ clipId: p.scenes[0].clip.id }).expect(200)).body.data;
    expect(back.scenes[0].assetId).toBeNull();
  }, 180_000);

  it('rejects other workspaces’ media and clears scenes when a file is deleted', async () => {
    const { auth, p } = await planned();
    const other = await registerUser({ verify: true });
    const init = await request(app).post('/api/assets/uploads').set(other.auth).send({ filename: 'x.png', contentType: 'image/png', sizeBytes: png.length, purpose: 'background' }).expect(201);
    await request(app).put(init.body.data.upload.url).set('Content-Type', 'image/png').send(png).expect(200);
    const theirs = (await request(app).post(`/api/assets/${init.body.data.asset.id}/complete`).set(other.auth).expect(200)).body.data;
    expect((await request(app).patch(`/api/projects/${p.id}/scenes/0`).set(auth).send({ assetId: theirs.id }).expect(400)).body.error.code).toBe('INVALID_ASSET');
    await request(app).post(`/api/projects/${p.id}/scenes/0/split`).set(other.auth).send({ atWord: 2 }).expect(404);

    const mine = await request(app).post('/api/assets/uploads').set(auth).send({ filename: 'm.png', contentType: 'image/png', sizeBytes: png.length, purpose: 'background' }).expect(201);
    await request(app).put(mine.body.data.upload.url).set('Content-Type', 'image/png').send(png).expect(200);
    const asset = (await request(app).post(`/api/assets/${mine.body.data.asset.id}/complete`).set(auth).expect(200)).body.data;
    await request(app).patch(`/api/projects/${p.id}/scenes/1`).set(auth).send({ assetId: asset.id }).expect(200);
    await request(app).delete(`/api/assets/${asset.id}`).set(auth).expect(204);
    const after = await Project.findById(p.id);
    expect(after!.scenes[1]!.assetId).toBeNull();
  }, 60_000);

  it('re-plans one scene with AI and blocks edits when the script changed', async () => {
    const { auth, p } = await planned();
    setLLMProvider({ name: 'fake', generateJson: async <T>() => ({ scenes: [{ index: 0, queries: ['steaming espresso', 'coffee'] }] }) as T } satisfies LLMProvider);
    const r = await request(app).post(`/api/projects/${p.id}/scenes/1/replan`).set(auth).expect(200);
    expect(r.body.meta).toMatchObject({ plannedWith: 'ai', found: 6 });
    expect(r.body.data.scenes[1].queries).toEqual(['steaming espresso', 'coffee']);
    expect(r.body.data.scenes[1].clip.id).toBe('steaming-espresso-1');

    await request(app).patch(`/api/projects/${p.id}`).set(auth).send({ script: `${SCRIPT} Extra.` }).expect(200);
    expect((await request(app).post(`/api/projects/${p.id}/scenes/0/split`).set(auth).send({ atWord: 2 }).expect(409)).body.error.code).toBe('SCENES_OUTDATED');
    expect((await request(app).patch(`/api/projects/${p.id}/scenes/0`).set(auth).send({ overlayText: 'Hi' }).expect(409)).body.error.code).toBe('SCENES_OUTDATED');
  }, 60_000);
});
