import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { sentEmails } from '../services/email.service.js';
import { FakeTts } from './fakeTts.js';
import { runFfmpeg } from '../services/video/ffmpeg.js';
import { Worker } from '../services/queue/worker.js';
import { registerNarrationJob } from '../services/audio/narrationJob.js';
import { registerPhotoAvatarJob, setAvatarPollMs } from '../services/avatar/photoAvatarJob.js';
import { setTtsProvider } from '../services/ai/tts.js';
import { setTranscriptionProvider, type TranscriptionProvider } from '../services/ai/transcription.js';
import { setAvatarProvider, type AvatarProvider } from '../services/ai/avatar.js';
import { consentStatement } from '../services/voice/consent.js';
import { Asset } from '../models/Asset.js';
import { ConsentRecord } from '../models/ConsentRecord.js';
import { PhotoAvatar } from '../models/PhotoAvatar.js';
import { Workspace } from '../models/Workspace.js';

const worker = new Worker(1, 10);
let tts: FakeTts;
let photoPng: Buffer; // 640×640
let tinyPng: Buffer; // 300×300
let consentWebm: Buffer;

let heard = '';
const fakeStt: TranscriptionProvider = {
  name: 'fake-stt',
  async transcribe(_p, { language }) {
    return { provider: 'fake-stt', language, words: heard.split(/\s+/).filter(Boolean).map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 })) };
  },
};

/** Stand-in avatar provider (no HeyGen calls). */
class FakeAvatars implements AvatarProvider {
  readonly name = 'fake-avatars';
  photos: Array<{ name: string; mimeType: string; idempotencyKey: string }> = [];
  deleted: string[] = [];
  lookPolls = 0;
  failLook: string | null = null;
  async listAvatars() {
    return [{ id: 'look1', name: 'Maya', gender: 'female', previewImageUrl: null, previewVideoUrl: null, orientation: 'portrait' as const, tags: [] }];
  }
  async createVideo() {
    return 'vid1';
  }
  async getVideo() {
    return { status: 'completed' as const, videoUrl: 'https://cdn.example.com/v.mp4', durationSec: 3, failure: null };
  }
  async download() {}
  async createPhotoAvatar(req: { name: string; mimeType: string; idempotencyKey: string }) {
    this.photos.push({ name: req.name, mimeType: req.mimeType, idempotencyKey: req.idempotencyKey });
    return { groupId: `ag_${this.photos.length}`, lookId: `photo_${this.photos.length}` };
  }
  async getLook() {
    this.lookPolls++;
    if (this.failLook) return { status: 'failed' as const, previewImageUrl: null, failure: this.failLook };
    if (this.lookPolls < 2) return { status: 'processing' as const, previewImageUrl: null, failure: null };
    return { status: 'completed' as const, previewImageUrl: 'https://img.example.com/me.png', failure: null };
  }
  async deleteAvatar(groupId: string) {
    this.deleted.push(groupId);
  }
}
let avatars: FakeAvatars;

beforeAll(async () => {
  await connectTestDb();
  registerPhotoAvatarJob();
  registerNarrationJob();
  setAvatarPollMs(5);
  const dir = await mkdtemp(path.join(tmpdir(), 'sis-photo-'));
  tts = new FakeTts(dir);
  const img = async (name: string, size: number) => {
    const f = path.join(dir, name);
    await runFfmpeg(['-f', 'lavfi', '-i', `testsrc=size=${size}x${size}:rate=1:duration=1`, '-frames:v', '1', f]);
    return readFile(f);
  };
  photoPng = await img('me.png', 640);
  tinyPng = await img('tiny.png', 300);
  const c = path.join(dir, 'consent.webm');
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', '-c:a', 'libopus', c]);
  consentWebm = await readFile(c);
}, 60_000);
beforeEach(async () => {
  await resetDb();
  avatars = new FakeAvatars();
  setAvatarProvider(avatars);
  setTranscriptionProvider(fakeStt);
  setTtsProvider(tts);
});
afterEach(() => {
  setAvatarProvider(undefined);
  setTranscriptionProvider(undefined);
  setTtsProvider(undefined);
});
afterAll(() => mongoose.disconnect());

const drain = async () => {
  while (await worker.runOnce(true)) {
    /* run queued jobs */
  }
};

async function upload(auth: Record<string, string>, body: Buffer, purpose: string, filename: string, contentType: string, expected = 200) {
  const init = await request(app).post('/api/assets/uploads').set(auth).send({ filename, contentType, sizeBytes: body.length, purpose });
  if (init.status !== 201) throw new Error(`upload init ${init.status}: ${JSON.stringify(init.body)}`);
  await request(app).put(init.body.data.upload.url).set('Content-Type', contentType).send(body).expect(200);
  const res = await request(app).post(`/api/assets/${init.body.data.asset.id}/complete`).set(auth);
  if (res.status !== expected) throw new Error(`complete ${res.status}: ${JSON.stringify(res.body)}`);
  return res;
}

async function setup(plan = 'creator', credits = 300) {
  const u = await registerUser({ verify: true, name: 'Asha Rao' });
  await Workspace.updateOne({ _id: u.user.defaultWorkspaceId }, { plan, creditBalance: credits });
  const ws = await Workspace.findById(u.user.defaultWorkspaceId);
  const photo = (await upload(u.auth, photoPng, 'avatar_photo', 'me.png', 'image/png')).body.data;
  const consent = (await upload(u.auth, consentWebm, 'consent', 'consent.webm', 'audio/webm')).body.data;
  return { ...u, ws: ws!, photo, consent };
}
const body = (s: { photo: { id: string }; consent: { id: string } }, extra: Record<string, unknown> = {}) => ({
  name: 'Me',
  relationship: 'self',
  subjectName: 'Asha Rao',
  attestations: { rightsAndConsent: true, notPublicFigure: true, acceptsUsePolicy: true },
  statementAssetId: s.consent.id,
  photoAssetId: s.photo.id,
  ...extra,
});
const balance = async (auth: Record<string, string>) => (await request(app).get('/api/auth/me').set(auth)).body.data.workspace.creditBalance as number;
const tokenFrom = (to: string, tag: string, p: 'confirm' | 'withdraw') => {
  const msg = [...sentEmails].reverse().find((m) => m.to === to && m.tag === tag);
  const m = msg?.text.match(new RegExp(`/consent/${p}\\?token=([A-Za-z0-9_-]+)`));
  if (!m?.[1]) throw new Error(`no ${p} link in ${tag} email to ${to}`);
  return m[1];
};

describe('photo avatars', () => {
  it('makes your own avatar from one photo after a spoken consent, charges once, and lets you use it as a cheaper presenter', async () => {
    const s = await setup();
    const statement = (await request(app).get('/api/avatars/photo/statement').query({ subjectName: 'Asha Rao' }).set(s.auth).expect(200)).body.data.statement;
    expect(statement).toBe(consentStatement('Asha Rao', s.ws.name, 'likeness'));
    expect(statement).toContain('AI avatar of my face');
    heard = statement;

    const res = await request(app).post('/api/avatars/photo').set(s.auth).send(body(s)).expect(201);
    expect(res.body.data).toMatchObject({ name: 'Me', status: 'creating', avatarId: null, consent: { status: 'active', kind: 'likeness' } });
    expect(await balance(s.auth)).toBe(300 - 80);
    await drain();
    expect(avatars.photos).toEqual([{ name: 'Me', mimeType: 'image/png', idempotencyKey: expect.stringContaining('sis-avatar-') }]);
    const list = (await request(app).get('/api/avatars/photo').set(s.auth).expect(200)).body.data;
    expect(list[0]).toMatchObject({ status: 'ready', avatarId: 'photo_1', previewImageUrl: 'https://img.example.com/me.png' });
    expect(sentEmails.some((m) => m.to === s.email && m.tag === 'consent_recorded' && /avatar/.test(m.subject))).toBe(true);

    // It's offered first among the presenters.
    const presenters = (await request(app).get('/api/ai/avatars').set(s.auth).expect(200)).body;
    expect(presenters.data[0]).toMatchObject({ id: 'photo_1', name: 'Me', own: true });
    expect(presenters.data[1]).toMatchObject({ id: 'look1', own: false });
    expect(presenters.meta.prices).toEqual({ stockPer30s: 160, ownPer30s: 80 });

    // A presenter video with your avatar costs 80 per 30 s (a stock presenter 160).
    const p = (
      await request(app)
        .post('/api/projects')
        .set(s.auth)
        .send({ title: 'Me talking', mode: 'avatar', script: 'Hi, I am Asha. Here are three tips.', settings: { voiceId: 'voiceA1', resolution: '720p', musicMood: 'none', avatarId: 'photo_1' } })
        .expect(201)
    ).body.data;
    await request(app).post(`/api/projects/${p.id}/narrate`).set(s.auth).expect(202);
    await drain();
    const est = (await request(app).get(`/api/projects/${p.id}/estimate`).set(s.auth).expect(200)).body.data;
    expect(est).toMatchObject({ presenterCredits: 80, photoAvatar: true });

    // Removing it withdraws consent: the avatar is deleted at the provider and the photo is gone.
    await request(app).delete(`/api/avatars/photo/${list[0].id}`).set(s.auth).expect(204);
    expect(avatars.deleted).toEqual(['ag_1']);
    expect(await PhotoAvatar.findOne()).toMatchObject({ status: 'revoked', photoAssetId: null });
    expect(await Asset.countDocuments({ kind: { $in: ['avatar_photo', 'consent_recording'] }, deletedAt: null })).toBe(0);
    expect((await request(app).get(`/api/projects/${p.id}/estimate`).set(s.auth).expect(409)).body.error.code).toBe('AVATAR_WITHDRAWN');
    // Another workspace can never use your avatar's id.
    const other = await registerUser({ verify: true });
    const q = (await request(app).post('/api/projects').set(other.auth).send({ title: 'x', mode: 'avatar', script: 'Hello there friends.', settings: { voiceId: 'voiceA1', avatarId: 'photo_1' } }).expect(201)).body.data;
    await Workspace.updateOne({ _id: other.user.defaultWorkspaceId }, { creditBalance: 50 });
    await request(app).post(`/api/projects/${q.id}/narrate`).set(other.auth).expect(202);
    await drain();
    expect((await request(app).get(`/api/projects/${q.id}/estimate`).set(other.auth).expect(400)).body.error.code).toBe('INVALID_AVATAR');
  }, 120_000);

  it("waits for someone else to confirm their face by email; their withdrawal deletes it", async () => {
    const s = await setup();
    heard = consentStatement('Ravi Kumar', s.ws.name, 'likeness');
    const res = await request(app).post('/api/avatars/photo').set(s.auth).send(body(s, { name: 'Ravi', relationship: 'other', subjectName: 'Ravi Kumar', subjectEmail: 'ravi@example.com' })).expect(201);
    expect(res.body.data).toMatchObject({ status: 'awaiting_consent', consent: { status: 'awaiting_subject' } });
    expect(await balance(s.auth)).toBe(300); // nothing charged before they agree
    const request_ = sentEmails.find((m) => m.to === 'ravi@example.com' && m.tag === 'consent_request');
    expect(request_?.subject).toMatch(/AI avatar of your face/);

    const confirm = tokenFrom('ravi@example.com', 'consent_request', 'confirm');
    const withdraw = tokenFrom('ravi@example.com', 'consent_request', 'withdraw');
    const info = (await request(app).post('/api/consent/lookup').send({ token: confirm, purpose: 'confirm' }).expect(200)).body.data;
    expect(info).toMatchObject({ kind: 'likeness', avatarName: 'Ravi', subjectName: 'Ravi Kumar' });
    await request(app).post('/api/consent/confirm').send({ token: confirm }).expect(200);
    await drain();
    expect(await PhotoAvatar.findOne()).toMatchObject({ status: 'ready', providerLookId: 'photo_1' });
    expect(await balance(s.auth)).toBe(220);

    await request(app).post('/api/consent/withdraw').send({ token: withdraw }).expect(200);
    expect(avatars.deleted).toEqual(['ag_1']);
    expect(await ConsentRecord.findOne()).toMatchObject({ status: 'revoked', revokedBy: 'subject' });
    expect(sentEmails.some((m) => m.to === s.email && m.tag === 'consent_withdrawn' && /avatar "Ravi"/.test(m.subject))).toBe(true);
  }, 120_000);

  it('refuses unmatched consent, small photos, free plans and empty wallets; refunds a failed avatar', async () => {
    const s = await setup();
    heard = 'hello this is just me talking';
    expect((await request(app).post('/api/avatars/photo').set(s.auth).send(body(s)).expect(400)).body.error.code).toBe('CONSENT_NOT_MATCHED');
    expect(await PhotoAvatar.countDocuments()).toBe(0);
    const tiny = await upload(s.auth, tinyPng, 'avatar_photo', 'tiny.png', 'image/png', 400);
    expect(tiny.body.error.message).toMatch(/at least 512 × 512/);

    const free = await setup('free');
    heard = consentStatement('Asha Rao', free.ws.name, 'likeness');
    expect((await request(app).post('/api/avatars/photo').set(free.auth).send(body(free)).expect(403)).body.error.code).toBe('PLAN_LIMIT');
    const poor = await setup('creator', 10);
    heard = consentStatement('Asha Rao', poor.ws.name, 'likeness');
    expect((await request(app).post('/api/avatars/photo').set(poor.auth).send(body(poor)).expect(402)).body.error.code).toBe('INSUFFICIENT_CREDITS');

    // The provider can't use the photo: the avatar fails and the 80 credits come back.
    heard = consentStatement('Asha Rao', s.ws.name, 'likeness');
    avatars.failLook = 'moderation_failed';
    await request(app).post('/api/avatars/photo').set(s.auth).send(body(s)).expect(201);
    await drain();
    const a = await PhotoAvatar.findOne({ workspaceId: s.user.defaultWorkspaceId });
    expect(a!.status).toBe('failed');
    expect(a!.failureReason).toMatch(/moderation_failed/);
    expect(await balance(s.auth)).toBe(300);
  }, 120_000);
});
