import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { Workspace } from '../models/Workspace.js';
import { Worker } from '../services/queue/worker.js';
import { registerRenderJob } from '../services/video/renderJob.js';
import { registerAnalyzeJob } from '../services/video/analyzeJob.js';
import { runFfmpeg } from '../services/video/ffmpeg.js';
import { setTranscriptionProvider, type TranscriptionProvider, type Word } from '../services/ai/transcription.js';
import { setLLMProvider, type LLMProvider } from '../services/ai/llm.js';
import { setStockProvider, type StockVideoProvider } from '../services/ai/stock.js';
import { env } from '../config/env.js';
import { writeFile } from 'node:fs/promises';
import { keepSegments, rangeToOutput, removedRanges, toOutputTime, type EditDoc } from '../services/video/edl.js';

let fixture: Buffer;
const worker = new Worker(1, 10);
// The 7 s clip: tone 0–2.5 s, silence 2.5–4.5 s, tone 4.5–7 s. "um" is a filler word.
const WORDS: Word[] = [
  { text: 'Consistency', start: 0.2, end: 0.9 },
  { text: 'beats', start: 0.95, end: 1.4 },
  { text: 'talent.', start: 1.45, end: 2.2 },
  { text: 'um', start: 4.6, end: 4.95, filler: true },
  { text: 'Every', start: 5.0, end: 5.5 },
  { text: 'single', start: 5.55, end: 6.0 },
  { text: 'time.', start: 6.05, end: 6.7 },
];
let transcribeCalls = 0;
const fakeStt: TranscriptionProvider = {
  name: 'fake-edl',
  async transcribe(_a, o) {
    transcribeCalls++;
    return { provider: 'fake-edl', language: o.language, words: WORDS };
  },
};

beforeAll(async () => {
  await connectTestDb();
  registerRenderJob();
  registerAnalyzeJob();
  const dir = await mkdtemp(path.join(tmpdir(), 'sis-edl-'));
  const file = path.join(dir, 'talk.mp4');
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=7',
    '-f', 'lavfi', '-i', "aevalsrc='if(between(t,2.5,4.5),0,0.4*sin(440*2*PI*t))':s=48000:d=7",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
  ]);
  fixture = await readFile(file);
}, 120_000);
beforeEach(async () => {
  await resetDb();
  transcribeCalls = 0;
  setTranscriptionProvider(fakeStt);
});
afterEach(() => setTranscriptionProvider(undefined));
afterAll(() => mongoose.disconnect());

async function editorProject() {
  const u = await registerUser({ verify: true });
  await Workspace.updateOne({ _id: u.user.defaultWorkspaceId }, { creditBalance: 50 });
  const init = await request(app).post('/api/assets/uploads').set(u.auth).send({ filename: 'talk.mp4', contentType: 'video/mp4', sizeBytes: fixture.length }).expect(201);
  await request(app).put(init.body.data.upload.url).set('Content-Type', 'video/mp4').send(fixture).expect(200);
  const asset = (await request(app).post(`/api/assets/${init.body.data.asset.id}/complete`).set(u.auth).expect(200)).body.data;
  const p = (
    await request(app)
      .post('/api/projects')
      .set(u.auth)
      .send({ title: 'Timeline', mode: 'editor', aspectRatio: '9:16', sourceAssetId: asset.id, settings: { resolution: '720p', framing: 'crop', bRollIntensity: 'none', musicMood: 'none', captionsEnabled: true } })
      .expect(201)
  ).body.data;
  return { ...u, p };
}
const balance = async (auth: Record<string, string>) => (await request(app).get('/api/auth/me').set(auth)).body.data.workspace.creditBalance as number;

describe('timeline rules', () => {
  const base: EditDoc = {
    sourceAssetId: 'x', analyzedAt: '', durationSec: 10,
    silences: [{ start: 2, end: 3 }, { start: 6, end: 6.4 }], fillers: [{ start: 8, end: 8.3 }],
    pauseSec: 0.6, removeFillers: true, cuts: [], restores: [], zooms: [], texts: [], segments: [],
  };

  it('cuts long pauses (with padding) and fillers, and respects the pause threshold', () => {
    expect(keepSegments(base)).toEqual([{ start: 0, end: 2.12 }, { start: 2.88, end: 8 }, { start: 8.3, end: 10 }]);
    // 0.3 s also cuts the short pause; Off keeps every pause.
    expect(keepSegments({ ...base, pauseSec: 0.3 })).toHaveLength(4);
    expect(keepSegments({ ...base, pauseSec: 0, removeFillers: false })).toEqual([{ start: 0, end: 10 }]);
  });

  it('applies manual cuts, and restores win over automatic cuts', () => {
    const cut = keepSegments({ ...base, cuts: [{ start: 4, end: 5 }] });
    expect(cut.some((s) => s.start <= 4.5 && s.end >= 4.5)).toBe(false);
    const restored = keepSegments({ ...base, restores: [{ start: 2, end: 3 }] });
    expect(restored[0]).toEqual({ start: 0, end: 8 });
    expect(removedRanges({ ...base, restores: [{ start: 2, end: 3 }] })).toEqual([{ start: 8, end: 8.3 }]);
  });

  it('maps source moments onto the edited timeline', () => {
    const segs = [{ start: 0, end: 2 }, { start: 3, end: 5 }];
    expect(toOutputTime(segs, 4)).toBe(3);
    expect(toOutputTime(segs, 2.5)).toBeNull();
    expect(rangeToOutput(segs, 1.5, 3.5)).toEqual({ start: 1.5, end: 2.5 });
    expect(rangeToOutput(segs, 2.1, 2.9)).toBeNull();
  });
});

describe('AI Video Editor timeline', () => {
  it('analyses the footage once (3 credits/min), then exports exactly the saved timeline for 2 credits/min', async () => {
    const { auth, p } = await editorProject();

    const est = (await request(app).get(`/api/projects/${p.id}/analyze/estimate`).set(auth).expect(200)).body.data;
    expect(est).toMatchObject({ credits: 3, transcribes: true });
    await request(app).post(`/api/projects/${p.id}/analyze`).set(auth).expect(202);
    await worker.runOnce();
    expect(await balance(auth)).toBe(47);

    const analysed = (await request(app).get(`/api/projects/${p.id}`).set(auth).expect(200)).body.data;
    const edit = analysed.edit as EditDoc;
    expect(edit).toMatchObject({ sourceAssetId: p.sourceAssetId, pauseSec: 0.6, removeFillers: true, segments: [] });
    expect(edit.durationSec).toBeCloseTo(7, 0);
    expect(edit.silences.some((s) => s.start < 2.7 && s.end > 4.3)).toBe(true); // the 2 s silence
    expect(edit.fillers).toHaveLength(1);
    const words = (await request(app).get(`/api/projects/${p.id}/words`).set(auth).expect(200)).body.data.words;
    expect(words).toHaveLength(7);

    // Caption lines were laid out at analysis (source time, fillers left out, one highlighted word).
    expect(edit.captions!.length).toBeGreaterThan(0);
    expect(edit.captions!.flatMap((c) => c.words.map((w) => w.text))).not.toContain('um');

    // Re-analysing the same footage is free and keeps the transcript.
    expect((await request(app).get(`/api/projects/${p.id}/analyze/estimate`).set(auth).expect(200)).body.data.credits).toBe(0);

    // Edit on the timeline: keep 0–2.2 s and 5.0–6.8 s, add a zoom and a text overlay.
    const segments = [{ start: 0, end: 2.2 }, { start: 5, end: 6.8 }];
    const saved = await request(app)
      .patch(`/api/projects/${p.id}/edit`)
      .set(auth)
      .send({
        cuts: [{ start: 2.2, end: 5 }],
        zooms: [{ at: 0.5, dur: 1, scale: 1.12 }],
        texts: [{ start: 5.1, end: 6, text: 'Every time', position: 'bottom', style: 'accent', size: 'l', color: '#E11D48' }],
        // The user rewrote the first caption line and highlighted its last word.
        captions: [{ words: [{ text: 'Consistency', start: 0.2, end: 0.9 }, { text: 'wins', start: 0.95, end: 2.2 }], keyword: 1 }, ...edit.captions!.slice(1)],
        segments,
      })
      .expect(200);
    expect(saved.body.data.edit.segments).toEqual(segments);
    await request(app).patch(`/api/projects/${p.id}/edit`).set(auth).send({ texts: [{ start: 1, end: 2, text: 'x', position: 'top', style: 'neon' }] }).expect(400);
    await request(app).patch(`/api/projects/${p.id}/edit`).set(auth).send({ segments: [{ start: 3, end: 2 }] }).expect(400);
    await request(app).patch(`/api/projects/${p.id}/edit`).set(auth).send({ segments: [{ start: 0, end: 3 }, { start: 2, end: 4 }] }).expect(400);
    await request(app).patch(`/api/projects/${p.id}/edit`).set(auth).send({ texts: [{ start: 1, end: 99, text: 'x', position: 'top' }] }).expect(400);

    // Export: priced as rendering only, and the result is exactly the kept 4 s.
    const quote = (await request(app).get(`/api/projects/${p.id}/estimate`).set(auth).expect(200)).body.data;
    expect(quote).toMatchObject({ credits: 2, rerender: true });
    await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(202);
    await worker.runOnce();
    const done = (await request(app).get(`/api/projects/${p.id}`).set(auth).expect(200)).body.data;
    expect(done.status).toBe('completed');
    expect(done.renderStats.outputDurationSec).toBeCloseTo(4, 0);
    expect(done.renderStats.cuts).toBe(1);
    expect(done.renderStats.captionsAdded).toBe(true);
    expect(done.renderStats.zoomCount).toBe(1);
    // The export used the timeline captions exactly as edited (and nothing from the cut part).
    expect(done.renderStats.captionsFromEdits).toBe(true);
    expect(done.captionLines[0]).toMatchObject({ text: 'Consistency wins', keyword: 'wins' });
    expect(done.captionLines.map((l: { text: string }) => l.text).join(' ')).not.toMatch(/um/);
    expect(transcribeCalls).toBe(1); // the export reused the analysis transcript
    expect(await balance(auth)).toBe(45);
  }, 180_000);

  it('rebuilds captions for a new caption style', async () => {
    const { auth, p } = await editorProject();
    await request(app).post(`/api/projects/${p.id}/analyze`).set(auth).expect(202);
    await worker.runOnce();
    const before = (await request(app).get(`/api/projects/${p.id}`).set(auth)).body.data.edit.captions as EditDoc['captions'];
    await request(app).patch(`/api/projects/${p.id}`).set(auth).send({ settings: { captionStyle: 'clean_minimal' } }).expect(200);
    const after = (await request(app).post(`/api/projects/${p.id}/captions/rebuild`).set(auth).expect(200)).body.data.edit.captions as EditDoc['captions'];
    // Clean minimal fits more words per line than Bold pop, so there are fewer lines.
    expect(after!.length).toBeLessThan(before!.length);
  }, 120_000);

  it('needs an analysis before timeline edits, and a new video needs a new analysis', async () => {
    const { auth, p } = await editorProject();
    expect((await request(app).patch(`/api/projects/${p.id}/edit`).set(auth).send({ pauseSec: 0.3 }).expect(409)).body.error.code).toBe('NOT_ANALYZED');
    await request(app).post(`/api/projects/${p.id}/analyze`).set(auth).expect(202);
    await worker.runOnce();
    await request(app).patch(`/api/projects/${p.id}/edit`).set(auth).send({ pauseSec: 0.3, removeFillers: false }).expect(200);
    // Point the project at different footage: the old edit no longer applies.
    const init = await request(app).post('/api/assets/uploads').set(auth).send({ filename: 'b.mp4', contentType: 'video/mp4', sizeBytes: fixture.length }).expect(201);
    await request(app).put(init.body.data.upload.url).set('Content-Type', 'video/mp4').send(fixture).expect(200);
    const other = (await request(app).post(`/api/assets/${init.body.data.asset.id}/complete`).set(auth).expect(200)).body.data;
    await request(app).patch(`/api/projects/${p.id}`).set(auth).send({ sourceAssetId: other.id }).expect(200);
    await request(app).patch(`/api/projects/${p.id}/edit`).set(auth).send({ pauseSec: 0.6 }).expect(409);
  }, 120_000);
});

describe('styled text overlays in the export', () => {
  it('writes boxed, coloured and sized titles into the overlay subtitle file', async () => {
    const { buildWatermarkAss } = await import('../services/video/captions.js');
    const ass = buildWatermarkAss({
      width: 720,
      height: 1280,
      durationSec: 5,
      watermark: false,
      titles: [
        { start: 0, end: 1, text: 'Plain' },
        { start: 1, end: 2, text: 'Boxed', style: 'box', position: 'bottom' },
        { start: 2, end: 3, text: 'Accent', style: 'accent', color: '#E11D48', size: 'l' },
        { start: 3, end: 4, text: 'Yellow', color: '#FACC15', position: 'middle' },
      ],
    });
    expect(ass).toMatch(/Style: TitleBox,.*,3,/); // opaque box style
    expect(ass).toContain(",Title,,0,0,0,,{\\fad(200,200)}Plain");
    expect(ass).toContain(",TitleBox,,0,0,0,,{\\fad(200,200)\\an2}Boxed");
    expect(ass).toContain("TitleBox,,0,0,0,,{\\fad(200,200)\\fs65\\3c&H481DE1&}Accent");
    expect(ass).toContain(",Title,,0,0,0,,{\\fad(200,200)\\an5\\c&H15CCFA&}Yellow");
  });
});

describe('B-roll and music tracks', () => {
  let redClip = '';
  const llm: LLMProvider = {
    name: 'fake-llm',
    async generateJson<T>(prompt: string, schema: { properties?: Record<string, unknown> }) {
      const key = Object.keys(schema.properties ?? {})[0]!;
      if (key === 'keywords') return { keywords: (JSON.parse(prompt.split(String.fromCharCode(10)).at(-1)!) as string[]).map((l) => l.split(' ').at(-1)!) } as T;
      if (key === 'moments') return { moments: [{ sentence: 1, queries: ['coffee cup'] }] } as T;
      throw new Error('unexpected');
    },
  };
  const clip = (id: string, q: string) => ({ id, provider: 'fake-stock', downloadUrl: `https://example.test/${id}.mp4`, pageUrl: `https://example.test/${id}`, author: 'tester', width: 640, height: 360, durationSec: 6, tags: q.split(' '), thumbnailUrl: `https://example.test/${id}.jpg` });
  const stock: StockVideoProvider = {
    name: 'fake-stock',
    license: 'test',
    async searchVideos(query) {
      return [clip(`${query.replace(/\s+/g, '-')}-1`, query), clip(`${query.replace(/\s+/g, '-')}-2`, query)];
    },
    async download(_clip, dest) {
      await writeFile(dest, await readFile(redClip));
    },
  };

  beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sis-broll-'));
    redClip = path.join(dir, 'red.mp4');
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=25:d=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', redClip]);
    // One licensed music track in the library.
    await runFfmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.1*sin(2*PI*220*t)':s=44100:d=12", '-c:a', 'libmp3lame', '-b:a', '128k', path.join(env.music.libraryDir, 'calm-bed-1234abcd.mp3')]);
    await writeFile(path.join(env.music.libraryDir, 'music.json'), JSON.stringify([{ file: 'calm-bed-1234abcd.mp3', title: 'Calm Bed', artist: 'Tester', moods: ['calm'], license: 'Pixabay Content License', durationSec: 12 }]));
  }, 120_000);
  // A transcript whose second sentence leaves room for a cutaway inside the 7 s clip.
  const BROLL_WORDS: Word[] = [
    { text: 'Consistency', start: 0.2, end: 0.8 }, { text: 'beats', start: 0.85, end: 1.3 }, { text: 'talent.', start: 1.35, end: 1.9 },
    { text: 'Every', start: 3.0, end: 3.4 }, { text: 'single', start: 3.45, end: 3.9 }, { text: 'day', start: 3.95, end: 4.3 }, { text: 'you', start: 4.6, end: 4.9 }, { text: 'win.', start: 4.95, end: 5.6 },
  ];
  beforeEach(() => {
    setTranscriptionProvider({ name: 'fake-broll', async transcribe(_a, o) { return { provider: 'fake-broll', language: o.language, words: BROLL_WORDS }; } });
    setLLMProvider(llm);
    setStockProvider(stock);
  });
  afterEach(() => {
    setLLMProvider(undefined);
    setStockProvider(undefined);
  });

  it('suggests B-roll you can swap and search, keeps download links private, and exports exactly what you chose', async () => {
    const { auth, p } = await editorProject();
    await request(app).post(`/api/projects/${p.id}/analyze`).set(auth).expect(202);
    await worker.runOnce();

    const sug = await request(app).post(`/api/projects/${p.id}/broll/suggest`).set(auth).send({ amount: 'medium' }).expect(200);
    expect(sug.body.meta.suggested).toBe(1);
    const edit = sug.body.data.edit as EditDoc;
    expect(edit.broll![0]).toMatchObject({ query: 'coffee cup', clipId: 'coffee-cup-1', candidateIds: ['coffee-cup-1', 'coffee-cup-2'] });
    expect(edit.broll![0]!.start).toBeGreaterThanOrEqual(3); // sentence 1 starts at 3.0 s
    expect(edit.broll![0]!.start).toBeLessThan(3.5);
    // The browser sees thumbnails and credits, never the download links.
    expect(JSON.stringify(sug.body.data)).not.toContain('downloadUrl');
    expect(edit.brollPool!['coffee-cup-2']).toMatchObject({ thumbnailUrl: 'https://example.test/coffee-cup-2.jpg', author: 'tester' });

    // Search adds new options; a clip that was never offered is refused.
    const found = await request(app).post(`/api/projects/${p.id}/broll/search`).set(auth).send({ query: 'sunrise' }).expect(200);
    expect(found.body.data.clips.map((c: { id: string }) => c.id)).toEqual(['sunrise-1', 'sunrise-2']);
    const swap = [{ start: 5, end: 6.5, query: 'sunrise', clipId: 'sunrise-2', candidateIds: ['sunrise-2', 'coffee-cup-1'] }];
    await request(app).patch(`/api/projects/${p.id}/edit`).set(auth).send({ broll: [{ ...swap[0], clipId: 'https://evil.test/x.mp4' }] }).expect(400);
    await request(app).patch(`/api/projects/${p.id}/edit`).set(auth).send({ broll: swap, music: { mode: 'track', file: 'calm-bed-1234abcd.mp3', volume: 0.3, duck: true } }).expect(200);
    await request(app).patch(`/api/projects/${p.id}/edit`).set(auth).send({ music: { mode: 'track', file: 'gone-0000aaaa.mp3', volume: 0.3, duck: true } }).expect(400);

    await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(202);
    await worker.runOnce();
    const done = (await request(app).get(`/api/projects/${p.id}`).set(auth).expect(200)).body.data;
    expect(done.status).toBe('completed');
    expect(done.renderStats.brollCount).toBe(1);
    expect(done.renderStats.broll[0]).toMatchObject({ query: 'sunrise', pageUrl: 'https://example.test/sunrise-2', author: 'tester' });
    expect(done.renderStats.music).toMatchObject({ title: 'Calm Bed' });
  }, 180_000);

  it('still suggests B-roll from keywords when the AI is down', async () => {
    const { auth, p } = await editorProject();
    await request(app).post(`/api/projects/${p.id}/analyze`).set(auth).expect(202);
    await worker.runOnce();
    setLLMProvider({ name: 'down', async generateJson() { throw new Error('AI unavailable'); } });
    const res = await request(app).post(`/api/projects/${p.id}/broll/suggest`).set(auth).send({ amount: 'medium' }).expect(200);
    expect(res.body.meta).toMatchObject({ plannedWith: 'keywords', suggested: 1 });
    expect(res.body.data.edit.broll[0].query).toMatch(/single|day/);
  }, 120_000);

  it('lists library music with expiring preview links', async () => {
    const { auth } = await registerUser({ verify: true });
    await request(app).get('/api/music').expect(401);
    const list = (await request(app).get('/api/music').set(auth).expect(200)).body.data.tracks;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ file: 'calm-bed-1234abcd.mp3', title: 'Calm Bed', moods: ['calm'] });
    const audio = await request(app).get(list[0].previewUrl).expect(200);
    expect(audio.headers['content-type']).toMatch(/audio\/mpeg/);
    await request(app).get(list[0].previewUrl.replace(/sig=[0-9a-f]+/, 'sig=00')).expect(403);
    await request(app).get('/api/music/audio/calm-bed-1234abcd.mp3?exp=1&sig=00').expect(403);
  });
});
