import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { runFfmpeg } from '../services/video/ffmpeg.js';
import { Worker } from '../services/queue/worker.js';
import { registerNarrationJob } from '../services/audio/narrationJob.js';
import { Asset } from '../models/Asset.js';
import { Project } from '../models/Project.js';
import { Workspace } from '../models/Workspace.js';
import { CreditTransaction } from '../models/CreditTransaction.js';
import {
  alignmentToWords,
  parseElevenVoice,
  setTtsProvider,
  splitScript,
  TtsError,
  type SynthesisOptions,
  type TtsProvider,
  type VoiceInfo,
} from '../services/ai/tts.js';
import { narrationCreditCost } from '../config/credits.js';

const worker = new Worker(1, 10);
const SEC_PER_CHAR = 0.04;

const VOICES: VoiceInfo[] = [
  { id: 'voiceA1', name: 'Asha', category: 'premade', gender: 'female', age: 'young', accent: 'indian', description: 'warm', useCase: 'narration', previewUrl: null, languages: ['en', 'hi'] },
  { id: 'voiceB2', name: 'Ravi', category: 'premade', gender: 'male', age: 'middle aged', accent: 'indian', description: 'calm', useCase: 'news', previewUrl: null, languages: ['en'] },
];

/** Stand-in provider: real MP3 audio (a tone) with linear per-character timings. Never calls a paid API. */
class FakeTts implements TtsProvider {
  readonly name = 'fake-tts';
  calls: Array<{ text: string; opts: SynthesisOptions }> = [];
  failWith: Error | null = null;
  constructor(private readonly dir: string) {}
  async listVoices() {
    return VOICES;
  }
  async synthesize(text: string, opts: SynthesisOptions) {
    this.calls.push({ text, opts });
    if (this.failWith) throw this.failWith;
    const dur = Math.max(0.5, text.length * SEC_PER_CHAR);
    const file = path.join(this.dir, `tts-${this.calls.length}.mp3`);
    await runFfmpeg(['-f', 'lavfi', '-i', `sine=frequency=330:duration=${dur}`, '-c:a', 'libmp3lame', '-b:a', '64k', file]);
    const characters = [...text];
    return {
      audio: await readFile(file),
      mimeType: 'audio/mpeg' as const,
      model: 'fake-model',
      alignment: {
        characters,
        starts: characters.map((_, i) => i * SEC_PER_CHAR),
        ends: characters.map((_, i) => (i + 1) * SEC_PER_CHAR),
      },
    };
  }
}

let fake: FakeTts;

beforeAll(async () => {
  await connectTestDb();
  registerNarrationJob();
  fake = new FakeTts(await mkdtemp(path.join(tmpdir(), 'sis-tts-')));
});
beforeEach(async () => {
  await resetDb();
  fake.calls = [];
  fake.failWith = null;
  setTtsProvider(fake);
});
afterEach(() => setTtsProvider(undefined));
afterAll(() => mongoose.disconnect());

async function avatarProject(auth: Record<string, string>, patch: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/projects')
    .set(auth)
    .send({ title: 'My explainer', mode: 'avatar', script: 'Hello there. This is a short test script.', settings: { voiceId: 'voiceA1' }, ...patch })
    .expect(201);
  return res.body.data;
}

const drain = async () => {
  while (await worker.runOnce(true)) {
    /* process queued jobs, including retries */
  }
};

describe('tts helpers', () => {
  it('groups character timings into words with an offset', () => {
    const chars = [...'Hi you'];
    const words = alignmentToWords({ characters: chars, starts: chars.map((_, i) => i * 0.1), ends: chars.map((_, i) => i * 0.1 + 0.1) }, 2);
    expect(words).toEqual([
      { text: 'Hi', start: 2, end: 2.2 },
      { text: 'you', start: 2.3, end: 2.6 },
    ]);
  });

  it('splits long scripts at sentence boundaries without losing text', () => {
    const sentence = 'This sentence has some words in it. ';
    const script = sentence.repeat(200); // ~7200 chars
    const chunks = splitScript(script, 2500);
    expect(chunks.length).toBe(3);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(2500);
      expect(c.endsWith('.')).toBe(true);
    }
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(script.trim().replace(/\s+/g, ' '));
    expect(splitScript('नमस्ते। यह एक परीक्षण है।', 10)).toEqual(['नमस्ते।', 'यह एक', 'परीक्षण', 'है।']);
    expect(splitScript('   ')).toEqual([]);
  });

  it('maps ElevenLabs voices to the neutral shape', () => {
    const v = parseElevenVoice({
      voice_id: 'abc',
      name: 'Aria',
      category: 'premade',
      labels: { gender: 'female', accent: 'american', use_case: 'social_media', age: 'young' },
      preview_url: 'https://storage.example.com/aria.mp3',
      verified_languages: [{ language: 'en' }, { language: 'hi' }, { language: 'en' }],
    });
    expect(v).toMatchObject({ id: 'abc', name: 'Aria', gender: 'female', accent: 'american', useCase: 'social media', languages: ['en', 'hi'] });
    expect(parseElevenVoice({ voice_id: 'x', preview_url: 'http://insecure' }).previewUrl).toBeNull();
  });

  it('prices voiceovers per started 400 characters', () => {
    expect(narrationCreditCost(1)).toBe(1);
    expect(narrationCreditCost(400)).toBe(1);
    expect(narrationCreditCost(401)).toBe(2);
    expect(narrationCreditCost(5000)).toBe(13);
  });
});

describe('voices API', () => {
  it('lists voices when configured and says so honestly when not', async () => {
    const { auth } = await registerUser({ verify: true });
    const res = await request(app).get('/api/voices').set(auth).expect(200);
    expect(res.body.data.map((v: VoiceInfo) => v.id)).toEqual(['voiceA1', 'voiceB2']);

    setTtsProvider(null);
    const off = await request(app).get('/api/voices').set(auth).expect(503);
    expect(off.body.error.code).toBe('NOT_CONFIGURED');
    const meta = await request(app).get('/api/meta').expect(200);
    expect(meta.body.data.features.voices).toBe(false);
  });

  it('requires sign-in', async () => {
    await request(app).get('/api/voices').expect(401);
  });
});

describe('voiceover generation', () => {
  it('charges credits, generates audio with word timings and stores it', async () => {
    const { auth, user } = await registerUser({ verify: true });
    await Workspace.updateOne({ _id: user.defaultWorkspaceId }, { creditBalance: 10 });
    const project = await avatarProject(auth);

    const est = await request(app).get(`/api/projects/${project.id}/narration/estimate`).set(auth).expect(200);
    expect(est.body.data).toMatchObject({ credits: 1, balance: 10, characters: 41 });

    const gen = await request(app).post(`/api/projects/${project.id}/narrate`).set(auth).expect(202);
    expect(gen.body.data.credits).toBe(1);
    await drain();

    const res = await request(app).get(`/api/projects/${project.id}`).set(auth).expect(200);
    const p = res.body.data;
    expect(p.status).toBe('completed');
    expect(p.narrationAsset).toMatchObject({ kind: 'narration_audio', mimeType: 'audio/mpeg', status: 'ready' });
    expect(p.narrationAsset.durationSec).toBeGreaterThan(1.4);
    expect(p.narrationStats).toMatchObject({ voiceId: 'voiceA1', voiceName: 'Asha', chunks: 1, wordCount: 8, timingsAvailable: true, creditsCharged: 1, provider: 'fake-tts' });
    expect(p.narrationWords).toBeUndefined(); // timings stay server-side

    const stored = await Project.findById(project.id).select('+narrationWords');
    expect(stored!.narrationWords.map((w) => w.text)).toEqual(['Hello', 'there.', 'This', 'is', 'a', 'short', 'test', 'script.']);
    expect(fake.calls[0]!.opts).toMatchObject({ voiceId: 'voiceA1', language: 'en', speed: 1 });

    const ws = await Workspace.findById(user.defaultWorkspaceId);
    expect(ws!.creditBalance).toBe(9);
    // The audio is playable through a signed URL.
    const url = await request(app).get(`/api/assets/${p.narrationAsset.id}/url`).set(auth).expect(200);
    expect(url.body.data.url).toContain('/api/storage/');
  });

  it('offsets word timings across chunks and replaces the previous voiceover', async () => {
    const { auth, user } = await registerUser({ verify: true });
    await Workspace.updateOne({ _id: user.defaultWorkspaceId }, { creditBalance: 50 });
    const script = 'One two three four five six seven eight. '.repeat(70).trim(); // ~2900 chars → 2 chunks
    const project = await avatarProject(auth, { script });
    await request(app).post(`/api/projects/${project.id}/narrate`).set(auth).expect(202);
    await drain();
    const first = await Project.findById(project.id).select('+narrationWords');
    expect(first!.narrationStats!.chunks).toBe(2);
    const w = first!.narrationWords;
    for (let i = 1; i < w.length; i++) expect(w[i]!.start).toBeGreaterThanOrEqual(w[i - 1]!.start);
    expect(w[w.length - 1]!.end).toBeGreaterThan(script.length * SEC_PER_CHAR * 0.9);
    // Neighbouring text was passed for natural flow.
    expect(fake.calls[1]!.opts.previousText).toBe(fake.calls[0]!.text);

    await request(app).post(`/api/projects/${project.id}/narrate`).set(auth).expect(202);
    await drain();
    const second = await Project.findById(project.id);
    expect(second!.narrationAssetId!.equals(first!.narrationAssetId!)).toBe(false);
    const old = await Asset.findById(first!.narrationAssetId);
    expect(old!.deletedAt).toBeTruthy();
  });

  it('refunds credits once when the provider rejects the request permanently', async () => {
    const { auth, user } = await registerUser({ verify: true });
    await Workspace.updateOne({ _id: user.defaultWorkspaceId }, { creditBalance: 5 });
    const project = await avatarProject(auth);
    fake.failWith = new TtsError('Your ElevenLabs character quota is used up.', 401, true);
    await request(app).post(`/api/projects/${project.id}/narrate`).set(auth).expect(202);
    await drain();
    expect(fake.calls.length).toBe(1); // permanent: no retries
    const p = await Project.findById(project.id);
    expect(p!.status).toBe('failed');
    expect(p!.lastError).toMatch(/quota.*refunded/i);
    const ws = await Workspace.findById(user.defaultWorkspaceId);
    expect(ws!.creditBalance).toBe(5);
    expect(await CreditTransaction.countDocuments({ workspaceId: user.defaultWorkspaceId, type: 'refund' })).toBe(1);
  });

  it('validates the script, voice, mode and balance before charging', async () => {
    const { auth, user } = await registerUser({ verify: true });
    await Workspace.updateOne({ _id: user.defaultWorkspaceId }, { creditBalance: 100 });

    const empty = await avatarProject(auth, { script: '' });
    expect((await request(app).post(`/api/projects/${empty.id}/narrate`).set(auth).expect(400)).body.error.code).toBe('NO_SCRIPT');

    const long = await avatarProject(auth, { script: 'a'.repeat(5001) });
    expect((await request(app).post(`/api/projects/${long.id}/narrate`).set(auth).expect(400)).body.error.code).toBe('SCRIPT_TOO_LONG');

    const noVoice = await avatarProject(auth, { settings: { voiceId: '' } });
    expect((await request(app).post(`/api/projects/${noVoice.id}/narrate`).set(auth).expect(400)).body.error.code).toBe('NO_VOICE');

    const badVoice = await avatarProject(auth, { settings: { voiceId: 'missing99' } });
    expect((await request(app).post(`/api/projects/${badVoice.id}/narrate`).set(auth).expect(400)).body.error.code).toBe('INVALID_VOICE');

    const editor = await request(app).post('/api/projects').set(auth).send({ title: 'Edit', mode: 'editor', script: 'hi' }).expect(201);
    expect((await request(app).post(`/api/projects/${editor.body.data.id}/narrate`).set(auth).expect(400)).body.error.code).toBe('WRONG_MODE');

    await request(app).post('/api/projects').set(auth).send({ title: 'x', mode: 'avatar', settings: { voiceId: 'bad id!' } }).expect(400);
    await request(app).post('/api/projects').set(auth).send({ title: 'x', mode: 'avatar', settings: { speakingRate: 2 } }).expect(400);

    await Workspace.updateOne({ _id: user.defaultWorkspaceId }, { creditBalance: 0 });
    const ok = await avatarProject(auth);
    await request(app).post(`/api/projects/${ok.id}/narrate`).set(auth).expect(402);
    expect((await Project.findById(ok.id))!.status).toBe('draft');
    expect(fake.calls.length).toBe(0);

    setTtsProvider(null);
    expect((await request(app).post(`/api/projects/${ok.id}/narrate`).set(auth).expect(503)).body.error.code).toBe('NOT_CONFIGURED');
  });

  it("never lets one workspace narrate another's project", async () => {
    const a = await registerUser({ verify: true });
    const b = await registerUser({ verify: true });
    const project = await avatarProject(a.auth);
    await request(app).post(`/api/projects/${project.id}/narrate`).set(b.auth).expect(404);
    await request(app).get(`/api/projects/${project.id}/narration/estimate`).set(b.auth).expect(404);
  });
});
