import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';

beforeAll(connectTestDb);
beforeEach(resetDb);
afterAll(() => mongoose.disconnect());

const draft = { title: 'My first reel', mode: 'editor', aspectRatio: '9:16', style: 'viral' };

describe('projects', () => {
  it('requires a verified email to create projects', async () => {
    const { auth } = await registerUser();
    const res = await request(app).post('/api/projects').set(auth).send(draft).expect(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('creates, reads, updates, lists and deletes a project', async () => {
    const { auth } = await registerUser({ verify: true });
    const created = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ ...draft, settings: { language: 'te', captionPosition: 'middle' } })
      .expect(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({ status: 'draft', mode: 'editor' });
    expect(created.body.data.settings).toMatchObject({ language: 'te', captionPosition: 'middle', captionsEnabled: true });

    const updated = await request(app)
      .patch(`/api/projects/${id}`)
      .set(auth)
      .send({ title: 'Renamed', settings: { resolution: '720p' } })
      .expect(200);
    expect(updated.body.data.title).toBe('Renamed');
    expect(updated.body.data.settings).toMatchObject({ resolution: '720p', language: 'te' });

    const list = await request(app).get('/api/projects?q=renam').set(auth).expect(200);
    expect(list.body.meta.total).toBe(1);

    await request(app).delete(`/api/projects/${id}`).set(auth).expect(204);
    await request(app).get(`/api/projects/${id}`).set(auth).expect(404);
  });

  it('validates input and rejects unknown fields', async () => {
    const { auth } = await registerUser({ verify: true });
    await request(app).post('/api/projects').set(auth).send({ ...draft, mode: 'hologram' }).expect(400);
    await request(app).post('/api/projects').set(auth).send({ ...draft, status: 'completed' }).expect(400);
    await request(app).post('/api/projects').set(auth).send({ ...draft, workspaceId: new mongoose.Types.ObjectId() }).expect(400);
    await request(app).get('/api/projects/not-an-id').set(auth).expect(400);
  });

  it('isolates tenants: users cannot see or modify other workspaces’ projects', async () => {
    const alice = await registerUser({ verify: true });
    const bob = await registerUser({ verify: true });
    const { body } = await request(app).post('/api/projects').set(alice.auth).send(draft).expect(201);
    const id = body.data.id;

    await request(app).get(`/api/projects/${id}`).set(bob.auth).expect(404);
    await request(app).patch(`/api/projects/${id}`).set(bob.auth).send({ title: 'pwned' }).expect(404);
    await request(app).delete(`/api/projects/${id}`).set(bob.auth).expect(404);
    const bobList = await request(app).get('/api/projects').set(bob.auth).expect(200);
    expect(bobList.body.meta.total).toBe(0);

    const still = await request(app).get(`/api/projects/${id}`).set(alice.auth).expect(200);
    expect(still.body.data.title).toBe(draft.title);
  });

  it('paginates', async () => {
    const { auth } = await registerUser({ verify: true });
    for (let i = 0; i < 5; i++) await request(app).post('/api/projects').set(auth).send({ ...draft, title: `P${i}` });
    const page = await request(app).get('/api/projects?limit=2&page=3').set(auth).expect(200);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toMatchObject({ total: 5, totalPages: 3, page: 3 });
  });

  it('partial updates only change the fields that were sent', async () => {
    const { auth } = await registerUser({ verify: true });
    const created = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ ...draft, aspectRatio: '16:9', style: 'podcast', script: 'Keep this script.', topic: 'Keep this topic', settings: { language: 'hi' } })
      .expect(201);
    const id = created.body.data.id;
    // A single setting (e.g. switching the faceless style) must not reset anything else.
    const r1 = await request(app).patch(`/api/projects/${id}`).set(auth).send({ settings: { captionPosition: 'top' } }).expect(200);
    expect(r1.body.data).toMatchObject({ script: 'Keep this script.', topic: 'Keep this topic', aspectRatio: '16:9', style: 'podcast' });
    expect(r1.body.data.settings).toMatchObject({ language: 'hi', captionPosition: 'top' });
    // Clearing an asset reference alone keeps everything too.
    const r2 = await request(app).patch(`/api/projects/${id}`).set(auth).send({ sourceAssetId: null }).expect(200);
    expect(r2.body.data).toMatchObject({ script: 'Keep this script.', aspectRatio: '16:9', style: 'podcast', title: 'My first reel' });
  });
});

describe('dashboard', () => {
  it('summarises real workspace data', async () => {
    const { auth } = await registerUser({ verify: true });
    await request(app).post('/api/projects').set(auth).send(draft).expect(201);
    const res = await request(app).get('/api/dashboard/summary').set(auth).expect(200);
    expect(res.body.data).toMatchObject({
      plan: { id: 'free' },
      credits: { balance: 3, usedThisMonth: 0 },
      projects: { total: 1, byStatus: { draft: 1, completed: 0 } },
    });
    expect(res.body.data.recentProjects).toHaveLength(1);
  });
});
