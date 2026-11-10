import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { FakeTts } from './fakeTts.js';
import { runFfmpeg } from '../services/video/ffmpeg.js';
import { Worker } from '../services/queue/worker.js';
import { registerCloneJob } from '../services/voice/cloneJob.js';
import { registerNarrationJob } from '../services/audio/narrationJob.js';
import { setTtsProvider } from '../services/ai/tts.js';
import { setTranscriptionProvider, type TranscriptionProvider } from '../services/ai/transcription.js';
import { consentStatement, statementMatchScore } from '../services/voice/consent.js';
import { sentEmails } from '../services/email.service.js';
import { Asset } from '../models/Asset.js';
import { ConsentRecord } from '../models/ConsentRecord.js';
import { CustomVoice } from '../models/CustomVoice.js';
import { Workspace } from '../models/Workspace.js';
import { AuditLog } from '../models/AuditLog.js';

const worker = new Worker(1, 10);
let fake: FakeTts;
let sampleMp3: Buffer; // 35 s
let shortMp3: Buffer; // 2 s
let consentWebm: Buffer; // 8 s, browser-style recording

/** Speech-to-text stand-in: "hears" whatever the test sets. */
let heard = '';
const fakeStt: TranscriptionProvider = {
  name: 'fake-stt',
  async transcribe(_p, { language }) {
    return { provider: 'fake-stt', language, words: heard.split(/\s+/).filter(Boolean).map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 })) };
  },
};

beforeAll(async () => {
  await connectTestDb();
  registerCloneJob();
  registerNarrationJob();
  const dir = await mkdtemp(path.join(tmpdir(), 'sis-voice-'));
  fake = new FakeTts(dir);
  const make = async (name: string, dur: number, args: string[]) => {
    const f = path.join(dir, name);
    await runFfmpeg(['-f', 'lavfi', '-i', `sine=frequency=220:duration=${dur}`, ...args, f]);
    return readFile(f);
  };
  sampleMp3 = await make('sample.mp3', 35, ['-c:a', 'libmp3lame', '-b:a', '64k']);
  shortMp3 = await make('short.mp3', 2, ['-c:a', 'libmp3lame', '-b:a', '64k']);
  consentWebm = await make('consent.webm', 8, ['-c:a', 'libopus']);
}, 60_000);
beforeEach(async () => {
  await resetDb();
  fake.calls = [];
  fake.clones = [];
  fake.deleted = [];
  fake.cloneFailWith = null;
  setTtsProvider(fake);
  setTranscriptionProvider(fakeStt);
});
afterEach(() => {
  setTtsProvider(undefined);
  setTranscriptionProvider(undefined);
});
afterAll(() => mongoose.disconnect());

const drain = async () => {
  while (await worker.runOnce(true)) {
    /* run queued jobs */
  }
};

async function uploadAudio(auth: Record<string, string>, body: Buffer, purpose: 'voice_sample' | 'consent', filename: string, contentType: string, expected = 200) {
  const init = await request(app).post('/api/assets/uploads').set(auth).send({ filename, contentType, sizeBytes: body.length, purpose });
  if (init.status !== 201) throw new Error(`upload init ${init.status}: ${JSON.stringify(init.body)}`);
  await request(app).put(init.body.data.upload.url).set('Content-Type', contentType).send(body).expect(200);
  const res = await request(app).post(`/api/assets/${init.body.data.asset.id}/complete`).set(auth);
  if (res.status !== expected) throw new Error(`complete ${res.status}: ${JSON.stringify(res.body)}`);
  return res;
}

async function setup(plan = 'creator') {
  const u = await registerUser({ verify: true, name: 'Asha Rao' });
  await Workspace.updateOne({ _id: u.user.defaultWorkspaceId }, { plan, creditBalance: 20 });
  const ws = await Workspace.findById(u.user.defaultWorkspaceId);
  const sample = (await uploadAudio(u.auth, sampleMp3, 'voice_sample', 'me.mp3', 'audio/mpeg')).body.data;
  const consent = (await uploadAudio(u.auth, consentWebm, 'consent', 'consent.webm', 'audio/webm')).body.data;
  return { ...u, ws: ws!, sample, consent };
}

const body = (s: { sample: { id: string }; consent: { id: string } }, extra: Record<string, unknown> = {}) => ({
  name: 'My voice',
  relationship: 'self',
  subjectName: 'Asha Rao',
  attestations: { rightsAndConsent: true, notPublicFigure: true, acceptsUsePolicy: true },
  statementAssetId: s.consent.id,
  sampleAssetIds: [s.sample.id],
  ...extra,
});

const tokenFrom = (to: string, tag: string, path: 'confirm' | 'withdraw') => {
  const msg = [...sentEmails].reverse().find((m) => m.to === to && m.tag === tag);
  const m = msg?.text.match(new RegExp(`/consent/${path}\\?token=([A-Za-z0-9_-]+)`));
  if (!m?.[1]) throw new Error(`no ${path} link in ${tag} email to ${to}`);
  return m[1];
};

describe('consent statement matching', () => {
  it('scores how much of the statement was said', () => {
    const st = consentStatement('Asha Rao', 'Asha’s Studio');
    expect(st).toContain('I, Asha Rao, agree');
    expect(statementMatchScore(st, st)).toBe(1);
    expect(statementMatchScore(st, st.replace('Rao', 'Row'))).toBeGreaterThan(0.9);
    expect(statementMatchScore(st, 'hello this is my voice sample')).toBeLessThan(0.3);
    expect(statementMatchScore(st, '')).toBe(0);
  });
});

describe('audio uploads', () => {
  it('accepts MP3 and browser WEBM recordings and rejects non-audio or too-short files', async () => {
    const { auth, sample, consent } = await setup();
    expect(sample).toMatchObject({ kind: 'voice_sample', status: 'ready', hasAudio: true });
    expect(sample.durationSec).toBeGreaterThan(34);
    expect(consent.kind).toBe('consent_recording');
    expect(consent.durationSec).toBeGreaterThan(7);

    const tooShort = await uploadAudio(auth, shortMp3, 'voice_sample', 'x.mp3', 'audio/mpeg', 400);
    expect(tooShort.body.error.message).toMatch(/too short/);
    const fakeAudio = await uploadAudio(auth, Buffer.from('not audio at all'.repeat(100)), 'voice_sample', 'x.mp3', 'audio/mpeg', 400);
    expect(fakeAudio.body.error.code).toBe('INVALID_UPLOAD');
    await request(app).post('/api/assets/uploads').set(auth).send({ filename: 'x.exe', contentType: 'audio/mpeg', sizeBytes: 10, purpose: 'voice_sample' }).expect(400);

    // Recordings are managed through their voice, not deleted one by one, and stay out of the Media Library.
    expect((await request(app).delete(`/api/assets/${sample.id}`).set(auth).expect(409)).body.error.code).toBe('ASSET_MANAGED');
    expect((await request(app).get('/api/assets').set(auth).expect(200)).body.meta.total).toBe(0);
  });
});

describe('cloning my own voice', () => {
  it('verifies the spoken consent, clones, and makes the voice usable for voiceovers', async () => {
    const s = await setup();
    const status = await request(app).get('/api/voices/custom/status').set(s.auth).expect(200);
    expect(status.body.data).toMatchObject({ limit: 3, used: 0, voicesConfigured: true, consentCheckConfigured: true });
    const st = (await request(app).get('/api/voices/custom/statement').query({ subjectName: 'Asha Rao' }).set(s.auth).expect(200)).body.data.statement;
    heard = st;

    const res = await request(app).post('/api/voices/custom').set(s.auth).send(body(s)).expect(201);
    expect(res.body.data).toMatchObject({ status: 'cloning', voiceId: null, consent: { status: 'active', relationship: 'self', subjectEmail: s.email } });
    expect(res.body.data.consent.statementMatch).toBe(1);
    // A record of consent with a withdraw link goes to the person.
    expect(tokenFrom(s.email, 'consent_recorded', 'withdraw')).toBeTruthy();

    await drain();
    expect(fake.clones).toHaveLength(1);
    expect(fake.clones[0]!.files[0]).toMatchObject({ filename: 'sample-1.mp3', mimeType: 'audio/mpeg' });
    const list = (await request(app).get('/api/voices/custom').set(s.auth).expect(200)).body.data;
    expect(list[0]).toMatchObject({ status: 'ready', voiceId: 'clone1', name: 'My voice' });

    const voices = (await request(app).get('/api/voices').set(s.auth).expect(200)).body.data;
    expect(voices[0]).toMatchObject({ id: 'clone1', category: 'custom', name: 'My voice' });
    expect(voices[0].previewUrl).toContain('/api/storage/');

    const project = (await request(app).post('/api/projects').set(s.auth).send({ title: 'Mine', mode: 'avatar', script: 'Hello from my own voice.', settings: { voiceId: 'clone1' } }).expect(201)).body.data;
    await request(app).post(`/api/projects/${project.id}/narrate`).set(s.auth).expect(202);
    await drain();
    expect(fake.calls[0]!.opts.voiceId).toBe('clone1');
    expect(await AuditLog.countDocuments({ action: 'consent.created' })).toBe(1);
  });

  it('rejects a consent recording that does not say the statement, creating nothing', async () => {
    const s = await setup();
    heard = 'testing one two three this is just my microphone';
    const res = await request(app).post('/api/voices/custom').set(s.auth).send(body(s)).expect(400);
    expect(res.body.error.code).toBe('CONSENT_NOT_MATCHED');
    expect(res.body.error.message).toMatch(/we heard/);
    expect(await ConsentRecord.countDocuments()).toBe(0);
    expect(await CustomVoice.countDocuments()).toBe(0);
  });

  it('enforces plan limits, sample length, attestations and configuration', async () => {
    const free = await setup('free');
    heard = consentStatement('Asha Rao', free.ws.name);
    expect((await request(app).post('/api/voices/custom').set(free.auth).send(body(free)).expect(403)).body.error.code).toBe('PLAN_LIMIT');

    const s = await setup();
    heard = consentStatement('Asha Rao', s.ws.name);
    const bad = await request(app).post('/api/voices/custom').set(s.auth).send(body(s, { attestations: { rightsAndConsent: true, notPublicFigure: false, acceptsUsePolicy: true } }));
    expect(bad.status).toBe(400);

    // Only ~8 s of "sample" audio (using the consent clip as a sample) is not enough.
    const short = (await uploadAudio(s.auth, consentWebm, 'voice_sample', 's.webm', 'audio/webm')).body.data;
    expect((await request(app).post('/api/voices/custom').set(s.auth).send(body(s, { sampleAssetIds: [short.id] })).expect(400)).body.error.code).toBe('SAMPLES_TOO_SHORT');

    // Someone else's voice needs their email.
    expect((await request(app).post('/api/voices/custom').set(s.auth).send(body(s, { relationship: 'other', subjectName: 'Ravi Kumar' })).expect(400)).body.error.code).toBe('SUBJECT_EMAIL_REQUIRED');

    setTranscriptionProvider(null);
    expect((await request(app).post('/api/voices/custom').set(s.auth).send(body(s)).expect(503)).body.error.code).toBe('NOT_CONFIGURED');
    setTranscriptionProvider(fakeStt);
    setTtsProvider(null);
    expect((await request(app).post('/api/voices/custom').set(s.auth).send(body(s)).expect(503)).body.error.code).toBe('NOT_CONFIGURED');
  });
});

describe("someone else's voice", () => {
  it('waits for the person to confirm by email, and their withdrawal deletes everything', async () => {
    const s = await setup();
    heard = consentStatement('Ravi Kumar', s.ws.name);
    const res = await request(app)
      .post('/api/voices/custom')
      .set(s.auth)
      .send(body(s, { name: 'Ravi', relationship: 'other', subjectName: 'Ravi Kumar', subjectEmail: 'ravi@example.com' }))
      .expect(201);
    expect(res.body.data).toMatchObject({ status: 'awaiting_consent', consent: { status: 'awaiting_subject' } });
    await drain();
    expect(fake.clones).toHaveLength(0); // nothing is created before the person agrees

    const confirm = tokenFrom('ravi@example.com', 'consent_request', 'confirm');
    const withdraw = tokenFrom('ravi@example.com', 'consent_request', 'withdraw');
    const info = await request(app).post('/api/consent/lookup').send({ token: confirm, purpose: 'confirm' }).expect(200);
    expect(info.body.data).toMatchObject({ subjectName: 'Ravi Kumar', requesterName: 'Asha Rao', voiceName: 'Ravi', status: 'awaiting_subject' });
    expect(info.body.data.statementText).toContain('I, Ravi Kumar, agree');

    await request(app).post('/api/consent/confirm').send({ token: confirm }).expect(200);
    await request(app).post('/api/consent/confirm').send({ token: confirm }).expect(404); // single use
    await drain();
    expect(fake.clones).toHaveLength(1);
    expect((await CustomVoice.findOne())!.status).toBe('ready');

    await request(app).post('/api/consent/withdraw').send({ token: withdraw }).expect(200);
    expect(fake.deleted).toEqual(['clone1']);
    const voice = await CustomVoice.findOne();
    expect(voice).toMatchObject({ status: 'revoked' });
    expect(voice!.deletedAt).toBeTruthy();
    const consent = await ConsentRecord.findOne();
    expect(consent).toMatchObject({ status: 'revoked', revokedBy: 'subject' });
    // Recordings are deleted; the consent record stays as evidence.
    expect(await Asset.countDocuments({ kind: { $in: ['voice_sample', 'consent_recording'] }, deletedAt: null })).toBe(0);
    expect(sentEmails.some((m) => m.to === s.email && m.tag === 'consent_withdrawn')).toBe(true);

    // The voice is gone from the list and can't be used.
    const voices = (await request(app).get('/api/voices').set(s.auth).expect(200)).body.data;
    expect(voices.some((v: { id: string }) => v.id === 'clone1')).toBe(false);
    const project = (await request(app).post('/api/projects').set(s.auth).send({ title: 'R', mode: 'avatar', script: 'Hi.', settings: { voiceId: 'clone1' } }).expect(201)).body.data;
    expect((await request(app).post(`/api/projects/${project.id}/narrate`).set(s.auth).expect(400)).body.error.code).toBe('INVALID_VOICE');

    // Withdrawing again is harmless.
    await request(app).post('/api/consent/withdraw').send({ token: withdraw }).expect(200);
  });

  it('expires unconfirmed requests and never clones if withdrawn first', async () => {
    const s = await setup();
    heard = consentStatement('Ravi Kumar', s.ws.name);
    await request(app)
      .post('/api/voices/custom')
      .set(s.auth)
      .send(body(s, { relationship: 'other', subjectName: 'Ravi Kumar', subjectEmail: 'ravi@example.com' }))
      .expect(201);
    const confirm = tokenFrom('ravi@example.com', 'consent_request', 'confirm');
    await ConsentRecord.updateOne({}, { confirmExpiresAt: new Date(Date.now() - 1000) });
    expect((await request(app).post('/api/consent/confirm').send({ token: confirm }).expect(410)).body.error.code).toBe('TOKEN_EXPIRED');

    await request(app).post('/api/consent/withdraw').send({ token: tokenFrom('ravi@example.com', 'consent_request', 'withdraw') }).expect(200);
    await drain();
    expect(fake.clones).toHaveLength(0);
    await request(app).post('/api/consent/lookup').send({ token: 'x'.repeat(40), purpose: 'withdraw' }).expect(404);
  });
});

describe('isolation and removal', () => {
  it("keeps one workspace's voices private and lets the owner remove them", async () => {
    const a = await setup();
    heard = consentStatement('Asha Rao', a.ws.name);
    const created = (await request(app).post('/api/voices/custom').set(a.auth).send(body(a)).expect(201)).body.data;
    await drain();

    const b = await registerUser({ verify: true });
    await Workspace.updateOne({ _id: b.user.defaultWorkspaceId }, { creditBalance: 10 });
    const bVoices = (await request(app).get('/api/voices').set(b.auth).expect(200)).body.data;
    expect(bVoices.some((v: { id: string }) => v.id === 'clone1')).toBe(false);
    expect((await request(app).get('/api/voices/custom').set(b.auth).expect(200)).body.data).toHaveLength(0);
    const bp = (await request(app).post('/api/projects').set(b.auth).send({ title: 'B', mode: 'avatar', script: 'Hi.', settings: { voiceId: 'clone1' } }).expect(201)).body.data;
    expect((await request(app).post(`/api/projects/${bp.id}/narrate`).set(b.auth).expect(400)).body.error.code).toBe('INVALID_VOICE');
    await request(app).delete(`/api/voices/custom/${created.id}`).set(b.auth).expect(404);
    // B can't use A's recordings either.
    expect((await request(app).post('/api/voices/custom').set(b.auth).send(body(a))).status).toBeGreaterThanOrEqual(400);

    await request(app).delete(`/api/voices/custom/${created.id}`).set(a.auth).expect(204);
    expect(fake.deleted).toEqual(['clone1']);
    expect(await ConsentRecord.findOne()).toMatchObject({ status: 'revoked', revokedBy: 'workspace' });
    expect((await request(app).get('/api/voices/custom').set(a.auth).expect(200)).body.data).toHaveLength(0);
  });

  it('marks the voice failed with the reason when the provider refuses permanently', async () => {
    const s = await setup();
    heard = consentStatement('Asha Rao', s.ws.name);
    const { TtsError } = await import('../services/ai/tts.js');
    fake.cloneFailWith = new TtsError('The voice provider account can’t create more cloned voices.', 403, true);
    await request(app).post('/api/voices/custom').set(s.auth).send(body(s)).expect(201);
    await drain();
    expect(fake.clones).toHaveLength(1); // permanent: no retries
    const v = (await request(app).get('/api/voices/custom').set(s.auth).expect(200)).body.data[0];
    expect(v).toMatchObject({ status: 'failed', voiceId: null });
    expect(v.failureReason).toMatch(/can’t create more cloned voices/);
  });
});
