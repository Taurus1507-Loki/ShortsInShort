import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { FakeTts } from './fakeTts.js';
import { SarvamProvider, sarvamError } from '../services/ai/sarvam.js';
import { getTtsProvider, setTtsProvider, type SynthesisOptions } from '../services/ai/tts.js';
import { setTranscriptionProvider, type TranscriptionProvider } from '../services/ai/transcription.js';
import { alignWords, estimateWords } from '../services/audio/align.js';
import { Worker } from '../services/queue/worker.js';
import { registerNarrationJob } from '../services/audio/narrationJob.js';
import { Project } from '../models/Project.js';
import { Workspace } from '../models/Workspace.js';
import { env } from '../config/env.js';

describe('Sarvam adapter (mocked HTTP)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const sarvam = new SarvamProvider('test-key', 'bulbul:v3');

  it('speaks with a stock speaker via /text-to-speech in the right language', async () => {
    let call: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      call = { url, init };
      return new Response(JSON.stringify({ request_id: 'r1', audios: [Buffer.from('MP3DATA').toString('base64')] }), { status: 200 });
    });
    const r = await sarvam.synthesize('నమస్కారం', { voiceId: 'priya', language: 'te', speed: 3 });
    expect(call!.url).toBe('https://api.sarvam.ai/text-to-speech');
    expect((call!.init.headers as Record<string, string>)['api-subscription-key']).toBe('test-key');
    expect(JSON.parse(String(call!.init.body))).toMatchObject({ text: 'నమస్కారం', language_code: 'te-IN', speaker: 'priya', model: 'bulbul:v3', pace: 2, output_audio_codec: 'mp3' });
    expect(r.audio.toString()).toBe('MP3DATA');
    expect(r.alignment).toBeNull(); // Sarvam has no timestamps
  });

  it('uses /voices/clone for cloned voices and creates/deletes clones', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/voices/create')) return new Response(JSON.stringify({ voice_id: 'vc_123' }), { status: 200 });
      if (url.includes('/voices/delete/')) return new Response('', { status: 404 });
      return new Response(JSON.stringify({ audio: Buffer.from('CLONED').toString('base64') }), { status: 200 });
    });
    const id = await sarvam.cloneVoice({ name: 'Me', language: 'hi', files: [{ filename: 'ref.mp3', data: Buffer.from('x'), mimeType: 'audio/mpeg' }] });
    expect(id).toBe('vc_123');
    expect(calls[0]!.init.body).toBeInstanceOf(FormData);
    expect((calls[0]!.init.body as FormData).get('language')).toBe('hi-IN');
    const r = await sarvam.synthesize('Hello', { voiceId: 'vc_123', language: 'en' });
    expect(calls[1]!.url).toBe('https://api.sarvam.ai/voices/clone');
    expect(JSON.parse(String(calls[1]!.init.body))).toMatchObject({ voice_id: 'vc_123', text: 'Hello', language_code: 'en-IN' });
    expect(r.audio.toString()).toBe('CLONED');
    await expect(sarvam.deleteVoice('vc_123')).resolves.toBeUndefined(); // already gone is fine
    expect(sarvam.maxChars('priya')).toBe(2000);
    expect(sarvam.maxChars('vc_123')).toBe(900);
    expect(sarvam.cloneSampleSec).toBe(15);
  });

  it('maps errors and lists speakers', async () => {
    expect(sarvamError(401, '{}')).toMatchObject({ permanent: true, message: 'Sarvam rejected the API key.' });
    expect(sarvamError(402, '{"error":{"code":"insufficient_quota_error"}}')).toMatchObject({ permanent: true, message: 'Your Sarvam credits are used up.' });
    expect(sarvamError(429, '').permanent).toBe(false);
    expect(sarvamError(422, '{"detail":[{"msg":"text too long"}]}').message).toMatch(/text too long/);
    const voices = await sarvam.listVoices();
    expect(voices.length).toBeGreaterThan(30);
    expect(voices.find((v) => v.id === 'priya')).toMatchObject({ name: 'Priya', gender: 'female', previewUrl: null });
  });

  it('is the default provider when its key is set', () => {
    const ai = env.ai as unknown as { ttsProvider: string; sarvam: unknown; elevenlabs: unknown };
    const saved = { ...ai };
    try {
      ai.sarvam = { apiKey: 's', model: 'bulbul:v3' };
      ai.elevenlabs = { apiKey: 'e', model: 'm', indicModel: 'v3' };
      ai.ttsProvider = 'auto';
      expect(getTtsProvider()!.name).toBe('sarvam');
      ai.ttsProvider = 'elevenlabs';
      expect(getTtsProvider()!.name).toBe('elevenlabs');
      ai.sarvam = null;
      ai.ttsProvider = 'auto';
      expect(getTtsProvider()!.name).toBe('elevenlabs');
    } finally {
      Object.assign(ai, saved);
    }
  });
});

describe('word timing without provider timestamps', () => {
  it('estimates by word length', () => {
    const w = estimateWords(['Hi', 'wonderful', 'world'], 1, 4);
    expect(w[0]!.start).toBe(1);
    expect(w[2]!.end).toBeLessThanOrEqual(4);
    expect(w[1]!.end - w[1]!.start).toBeGreaterThan(w[0]!.end - w[0]!.start);
  });

  it('keeps the script’s words and takes times from a transcript, filling gaps', () => {
    const transcript = [
      { text: 'coffee', start: 0.2, end: 0.6 },
      { text: 'change', start: 0.7, end: 1.0 }, // recognition slip for "changed"
      { text: 'how', start: 1.1, end: 1.3 },
      { text: 'cities', start: 1.4, end: 1.9 },
      { text: 'wake', start: 2.0, end: 2.3 },
    ];
    const { words, matched } = alignWords('Coffee changed how cities wake up.', transcript, 3);
    expect(words.map((w) => w.text)).toEqual(['Coffee', 'changed', 'how', 'cities', 'wake', 'up.']);
    expect(matched).toBe(5);
    expect(words[1]).toMatchObject({ start: 0.7, end: 1 });
    expect(words[5]!.start).toBeGreaterThanOrEqual(2.3); // unmatched last word placed after "wake"
    expect(words[5]!.end).toBeLessThanOrEqual(3);
    // Unrelated transcript → pure estimate across the whole audio.
    expect(alignWords('one two three four', [{ text: 'banana', start: 0, end: 1 }], 4).matched).toBe(0);
  });
});

describe('voiceovers with a timestamp-less provider (Sarvam-like)', () => {
  /** Real audio but no alignment — like Sarvam. */
  class NoTimestamps extends FakeTts {
    override async synthesize(text: string, opts: SynthesisOptions) {
      const r = await super.synthesize(text, opts);
      return { ...r, alignment: null };
    }
  }
  const worker = new Worker(1, 10);
  let tts: NoTimestamps;
  let samples = 0;
  beforeAll(async () => {
    await connectTestDb();
    registerNarrationJob();
    tts = new NoTimestamps(await mkdtemp(path.join(tmpdir(), 'sis-sarvamlike-')));
  });
  beforeEach(async () => {
    await resetDb();
    samples = 0;
    setTtsProvider(tts);
  });
  afterEach(() => {
    setTtsProvider(undefined);
    setTranscriptionProvider(undefined);
  });
  afterAll(() => mongoose.disconnect());

  const drain = async () => {
    while (await worker.runOnce(true)) {
      /* run jobs */
    }
  };

  async function narrate(script: string) {
    const u = await registerUser({ verify: true });
    await Workspace.updateOne({ _id: u.user.defaultWorkspaceId }, { creditBalance: 10 });
    const p = (await request(app).post('/api/projects').set(u.auth).send({ title: 'S', mode: 'avatar', script, settings: { voiceId: 'voiceA1' } }).expect(201)).body.data;
    await request(app).post(`/api/projects/${p.id}/narrate`).set(u.auth).expect(202);
    await drain();
    return Project.findById(p.id).select('+narrationWords');
  }

  it('times words from a transcript of the audio when speech-to-text is configured', async () => {
    const stt: TranscriptionProvider = {
      name: 'fake-stt',
      async transcribe() {
        return { provider: 'fake-stt', language: 'en', words: ['hello', 'from', 'sarvam', 'voices'].map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.3 })) };
      },
    };
    setTranscriptionProvider(stt);
    const p = await narrate('Hello from Sarvam voices.');
    expect(p!.narrationStats).toMatchObject({ timingsAvailable: true, timingSource: 'transcript', wordCount: 4 });
    expect(p!.narrationWords.map((w) => w.text)).toEqual(['Hello', 'from', 'Sarvam', 'voices.']);
    expect(p!.narrationWords[2]).toMatchObject({ start: 0.8, end: 1.1 });
  }, 60_000);

  it('estimates timings when no speech-to-text is configured', async () => {
    setTranscriptionProvider(null);
    const p = await narrate('Hello from Sarvam voices.');
    expect(p!.narrationStats).toMatchObject({ timingsAvailable: true, timingSource: 'estimate', wordCount: 4 });
    const w = p!.narrationWords;
    for (let i = 1; i < w.length; i++) expect(w[i]!.start).toBeGreaterThanOrEqual(w[i - 1]!.end as number);
  }, 60_000);

  it('generates a voice sample once and serves it from storage after that', async () => {
    const counting = new (class extends NoTimestamps {
      override async synthesize(text: string, opts: SynthesisOptions) {
        samples++;
        return super.synthesize(text, opts);
      }
    })(path.join(tmpdir()));
    setTtsProvider(counting);
    const { auth } = await registerUser({ verify: true });
    const a = await request(app).get('/api/voices/voiceA1/sample?language=te').set(auth).expect(200);
    expect(a.body.data.url).toContain('/api/storage/');
    await request(app).get('/api/voices/voiceA1/sample?language=te').set(auth).expect(200);
    expect(samples).toBe(1);
    expect(counting.calls[0]!.text).toContain('నమస్కారం');
    await request(app).get('/api/voices/unknown/sample').set(auth).expect(404);
  }, 60_000);
});
