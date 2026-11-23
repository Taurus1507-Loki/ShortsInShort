import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { Workspace } from '../models/Workspace.js';
import { Project } from '../models/Project.js';
import { BrandKit } from '../models/BrandKit.js';
import { kitFor } from '../services/brandKit.service.js';
import { runMigrations, MIGRATIONS } from '../services/migrations.js';

beforeAll(connectTestDb);
beforeEach(resetDb);
afterAll(() => mongoose.disconnect());

async function user(plan: string) {
  const u = await registerUser({ verify: true });
  await Workspace.updateOne({ _id: u.user.defaultWorkspaceId }, { plan });
  return u;
}

describe('brand kits', () => {
  it('starts with one default kit; the old single-kit API edits it', async () => {
    const { auth } = await user('free');
    const list = (await request(app).get('/api/brand-kits').set(auth).expect(200)).body;
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ name: 'Main brand', isDefault: true });
    expect(list.meta.limit).toBe(1);
    await request(app).put('/api/brand-kit').set(auth).send({ primaryColor: '#112233' }).expect(200);
    expect((await request(app).get('/api/brand-kits').set(auth)).body.data[0].primaryColor).toBe('#112233');
    // Free and Starter keep one kit.
    expect((await request(app).post('/api/brand-kits').set(auth).send({ name: 'Client A' }).expect(403)).body.error.code).toBe('PLAN_LIMIT');
  });

  it('lets agencies keep a kit per client, pick one per project, switch the default and delete kits', async () => {
    const { auth, user: u } = await user('creator');
    await request(app).put('/api/brand-kit').set(auth).send({ primaryColor: '#111111' }).expect(200);
    const a = (await request(app).post('/api/brand-kits').set(auth).send({ name: 'Client A' }).expect(201)).body.data;
    expect(a).toMatchObject({ name: 'Client A', isDefault: false, primaryColor: '#111111', logo: null }); // starts from the default look
    const b = (await request(app).post('/api/brand-kits').set(auth).send({ name: 'Client B' }).expect(201)).body.data;
    await request(app).post('/api/brand-kits').set(auth).send({ name: 'Client C' }).expect(403); // Creator: 3 kits
    await request(app).patch(`/api/brand-kits/${a.id}`).set(auth).send({ name: 'Acme', primaryColor: '#FF0000' }).expect(200);
    await request(app).patch(`/api/brand-kits/${a.id}`).set(auth).send({ isDefault: true }).expect(400);

    // A project uses its chosen kit; another workspace's kit id falls back to the default.
    const ws = u.defaultWorkspaceId as unknown as Types.ObjectId;
    expect((await kitFor(new Types.ObjectId(String(ws)), a.id))!.primaryColor).toBe('#FF0000');
    expect((await kitFor(new Types.ObjectId(String(ws)), null))!.primaryColor).toBe('#111111');
    const other = await user('creator');
    const otherKit = (await request(app).get('/api/brand-kits').set(other.auth)).body.data[0];
    expect((await kitFor(new Types.ObjectId(String(ws)), otherKit.id))!.primaryColor).toBe('#111111');

    const p = (await request(app).post('/api/projects').set(auth).send({ title: 'For Acme', mode: 'faceless', settings: { brandKitId: a.id } }).expect(201)).body.data;
    expect(p.settings.brandKitId).toBe(a.id);

    // The default can move; the default kit can't be deleted.
    await request(app).post(`/api/brand-kits/${b.id}/default`).set(auth).expect(200);
    const after = (await request(app).get('/api/brand-kits').set(auth)).body.data;
    expect(after.filter((k: { isDefault: boolean }) => k.isDefault).map((k: { id: string }) => k.id)).toEqual([b.id]);
    expect((await request(app).delete(`/api/brand-kits/${b.id}`).set(auth).expect(409)).body.error.code).toBe('DEFAULT_KIT');

    // Deleting a kit moves its projects to the default kit.
    await request(app).delete(`/api/brand-kits/${a.id}`).set(auth).expect(204);
    expect((await Project.findById(p.id))!.settings!.brandKitId).toBeNull();
    await request(app).delete(`/api/brand-kits/${a.id}`).set(other.auth).expect(404);
  });

  it('migrates one-kit workspaces to a default "Main brand" kit', async () => {
    const wsId = new Types.ObjectId();
    await BrandKit.collection.insertOne({ workspaceId: wsId, primaryColor: '#123456', createdAt: new Date(), updatedAt: new Date() });
    await runMigrations(MIGRATIONS.filter((m) => m.id === '2026-11-23-brand-kits'));
    const kit = await BrandKit.findOne({ workspaceId: wsId });
    expect(kit).toMatchObject({ isDefault: true, name: 'Main brand', primaryColor: '#123456' });
  });
});
