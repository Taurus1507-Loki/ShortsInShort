import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { FakeTts } from './fakeTts.js';
import { runFfmpeg } from '../services/video/ffmpeg.js';
import { Worker } from '../services/queue/worker.js';
import { registerNarrationJob } from '../services/audio/narrationJob.js';
import { KEY_GREEN, registerRenderJob, setAvatarPollInterval } from '../services/video/renderJob.js';
import { setTtsProvider } from '../services/ai/tts.js';
import { setLLMProvider } from '../services/ai/llm.js';
import { AvatarError, heyGenError, parseHeyGenLook, setAvatarProvider, type AvatarProvider, type AvatarVideoRequest } from '../services/ai/avatar.js';
import { buildBackgroundArgs } from '../services/video/background.js';
import { Asset } from '../models/Asset.js';
import { Job } from '../models/Job.js';
import { Project } from '../models/Project.js';
import { Workspace } from '../models/Workspace.js';

const worker = new Worker(1, 10);
let tts: FakeTts;
let clip: string; // green-screen "presenter": a box on #00B140

/** Stand-in avatar provider: accepts requests, reports processing then completed, "downloads" a real clip. */
class FakeAvatars implements AvatarProvider {
  readonly name = 'fake-avatars';
  created: AvatarVideoRequest[] = [];
  polls = 0;
  pollsBeforeDone = 1;
  failWith: 'failed' | 'transient' | null = null;
  async listAvatars() {
    return [
      { id: 'look1', name: 'Maya', gender: 'female', previewImageUrl: 'https://img.example.com/maya.jpg', previewVideoUrl: null, orientation: 'portrait' as const, tags: ['business'] },
      { id: 'look2', name: 'Arjun', gender: 'male', previewImageUrl: null, previewVideoUrl: null, orientation: 'landscape' as const, tags: [] },
    ];
  }
  async createVideo(req: AvatarVideoRequest) {
    this.created.push(req);
    return `vid${this.created.length}`;
  }
  async getVideo(id: string) {
    this.polls++;
    if (this.failWith === 'transient') {
      this.failWith = null;
      throw new AvatarError('The avatar provider is busy (rate limited). Retrying shortly.', 429);
    }
    if (this.failWith === 'failed') return { status: 'failed' as const, videoUrl: null, durationSec: null, failure: 'avatar_not_usable' };
    if (this.polls <= this.pollsBeforeDone) return { status: 'processing' as const, videoUrl: null, durationSec: null, failure: null };
    return { status: 'completed' as const, videoUrl: `https://cdn.example.com/${id}.mp4`, durationSec: 3, failure: null };
  }
  async download(_url: string, dest: string) {
    await copyFile(clip, dest);
  }
}
let avatars: FakeAvatars;

beforeAll(async () => {
  await connectTestDb();
  registerNarrationJob();
  registerRenderJob();
  setAvatarPollInterval(5);
  const dir = await mkdtemp(path.join(tmpdir(), 'sis-presenter-'));
  tts = new FakeTts(dir);
  clip = path.join(dir, 'presenter.mp4');
  await runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=0x00B140:s=720x1280:r=30:d=3`,
    '-vf', 'drawbox=x=260:y=500:w=200:h=600:color=red:t=fill',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clip,
  ]);
}, 60_000);
beforeEach(async () => {
  await resetDb();
  avatars = new FakeAvatars();
  setTtsProvider(tts);
  setAvatarProvider(avatars);
  setLLMProvider(null);
});
afterEach(() => {
  setTtsProvider(undefined);
  setAvatarProvider(undefined);
  setLLMProvider(undefined);
});
afterAll(() => mongoose.disconnect());

const drain = async () => {
  while (await worker.runOnce(true)) {
    /* run queued jobs */
  }
};

const SETTINGS = { voiceId: 'voiceA1', resolution: '720p', bRollIntensity: 'none', musicMood: 'none', zoomIntensity: 'off', avatarId: 'look1' };

async function setup(settings: Record<string, unknown> = {}) {
  const u = await registerUser({ verify: true });
  await Workspace.updateOne({ _id: u.user.defaultWorkspaceId }, { creditBalance: 50 });
  const p = (
    await request(app)
      .post('/api/projects')
      .set(u.auth)
      .send({ title: 'Presenter', mode: 'avatar', script: 'Hi, I am your presenter. Here are three tips.', settings: { ...SETTINGS, ...settings } })
      .expect(201)
  ).body.data;
  await request(app).post(`/api/projects/${p.id}/narrate`).set(u.auth).expect(202);
  await drain();
  return { ...u, p };
}

describe('provider adapter helpers', () => {
  it('maps HeyGen looks and errors', () => {
    expect(parseHeyGenLook({ id: 'lk_1', name: 'Maya', gender: 'female', preview_image_url: 'https://x/y.jpg', preview_video_url: 'http://insecure', tags: ['a'] })).toMatchObject({
      id: 'lk_1',
      previewImageUrl: 'https://x/y.jpg',
      previewVideoUrl: null,
    });
    const credit = heyGenError(402, JSON.stringify({ error: { code: 'insufficient_credit', message: 'Your account has 5 credits' } }));
    expect(credit).toMatchObject({ permanent: true, message: 'The avatar provider account is out of credit.' });
    expect(heyGenError(429, JSON.stringify({ error: { code: 'rate_limit_exceeded' } })).permanent).toBe(false);
    expect(heyGenError(500, 'oops').permanent).toBe(false);
  });

  it('composites the presenter full-frame or keyed over the background', () => {
    const base = { kind: 'brand' as const, width: 720, height: 1280, durationSec: 3, audioPath: 'a.mp3', output: 'o.mp4' };
    const full = buildBackgroundArgs({ ...base, presenter: { path: 'p.mp4', layout: 'full', keyColor: KEY_GREEN } }).join(' ');
    expect(full).not.toContain('gradients');
    expect(full).toContain('-i p.mp4');
    const overlay = buildBackgroundArgs({ ...base, presenter: { path: 'p.mp4', layout: 'overlay', keyColor: KEY_GREEN } }).join(' ');
    expect(overlay).toContain('gradients=');
    expect(overlay).toContain('chromakey=0x00B140');
    expect(overlay).toContain('overlay=(W-w)/2:H-h');
  });
});

describe('presenter API', () => {
  it('lists presenters and says so when not configured', async () => {
    const { auth } = await registerUser({ verify: true });
    const list = await request(app).get('/api/ai/avatars').set(auth).expect(200);
    expect(list.body.data.map((a: { id: string }) => a.id)).toEqual(['look1', 'look2']);
    setAvatarProvider(null);
    expect((await request(app).get('/api/ai/avatars').set(auth).expect(503)).body.error.code).toBe('NOT_CONFIGURED');
    expect((await request(app).get('/api/meta').expect(200)).body.data.features.avatarStudio).toBe(false);
  });
});

describe('talking presenter render', () => {
  it('charges for the presenter once, renders it full-frame, and reuses it on re-render', async () => {
    const { auth, p, user } = await setup({ backgroundColor: '#112233' });
    const est = (await request(app).get(`/api/projects/${p.id}/estimate`).set(auth).expect(200)).body.data;
    expect(est).toMatchObject({ presenterCredits: 5, presenterReused: false, credits: 6 });

    await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(202);
    await drain();
    const done = await Project.findById(p.id);
    expect(done!.status).toBe('completed');
    expect(avatars.created).toHaveLength(1);
    expect(avatars.created[0]).toMatchObject({ avatarId: 'look1', aspectRatio: '9:16', resolution: '720p', backgroundColor: '#112233' });
    expect(done!.renderStats).toMatchObject({ presenter: { avatarId: 'look1', layout: 'full', reused: false }, disclosure: true });
    expect(done!.avatarRender).toMatchObject({ status: 'completed', providerVideoId: 'vid1' });
    expect(await Asset.countDocuments({ kind: 'avatar_video', deletedAt: null })).toBe(1);
    const out = await Asset.findById(done!.outputAssetId);
    expect(out).toMatchObject({ width: 720, height: 1280 });

    // Same voiceover + presenter: no new provider request, no presenter charge.
    const again = (await request(app).get(`/api/projects/${p.id}/estimate`).set(auth).expect(200)).body.data;
    expect(again).toMatchObject({ presenterCredits: 0, presenterReused: true, credits: 1 });
    await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(202);
    await drain();
    expect(avatars.created).toHaveLength(1);
    expect((await Project.findById(p.id))!.renderStats!.presenter).toMatchObject({ reused: true });
    const ws = await Workspace.findById(user.defaultWorkspaceId);
    expect(ws!.creditBalance).toBe(50 - 1 - 6 - 1); // voiceover, first render, re-render
  }, 120_000);

  it('keys the presenter over the chosen background in overlay layout', async () => {
    const { auth, p } = await setup({ avatarLayout: 'overlay', background: 'color', backgroundColor: '#334455' });
    await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(202);
    await drain();
    expect(avatars.created[0]!.backgroundColor).toBe(KEY_GREEN);
    expect((await Project.findById(p.id))!.renderStats).toMatchObject({ presenter: { layout: 'overlay' }, background: 'color' });
  }, 120_000);

  it('polls the same provider video after a transient failure instead of paying twice', async () => {
    const { auth, p } = await setup();
    avatars.failWith = 'transient';
    await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(202);
    await drain();
    await Job.updateMany({ status: 'queued' }, { runAt: new Date() });
    await drain();
    expect((await Project.findById(p.id))!.status).toBe('completed');
    expect(avatars.created).toHaveLength(1);
  }, 120_000);

  it('fails with a refund when the provider fails the video', async () => {
    const { auth, p, user } = await setup();
    avatars.failWith = 'failed';
    await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(202);
    await drain();
    const proj = await Project.findById(p.id);
    expect(proj!.status).toBe('failed');
    expect(proj!.avatarRender).toBeNull();
    expect((await Workspace.findById(user.defaultWorkspaceId))!.creditBalance).toBe(49); // only the voiceover was kept
  }, 120_000);

  it('validates the presenter and configuration before charging', async () => {
    const { auth, p } = await setup({ avatarId: 'missing' });
    expect((await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(400)).body.error.code).toBe('INVALID_AVATAR');
    // A full-frame presenter doesn't need a background file; overlay does.
    await request(app).patch(`/api/projects/${p.id}`).set(auth).send({ settings: { avatarId: 'look1', background: 'image' } }).expect(200);
    await request(app).get(`/api/projects/${p.id}/estimate`).set(auth).expect(200);
    await request(app).patch(`/api/projects/${p.id}`).set(auth).send({ settings: { avatarLayout: 'overlay' } }).expect(200);
    expect((await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(400)).body.error.code).toBe('NO_BACKGROUND');
    setAvatarProvider(null);
    expect((await request(app).post(`/api/projects/${p.id}/generate`).set(auth).expect(503)).body.error.code).toBe('NOT_CONFIGURED');
  }, 60_000);
});
