import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, resetDb } from './helpers.js';
import { Workspace } from '../models/Workspace.js';
import { CreditTransaction } from '../models/CreditTransaction.js';
import { Project } from '../models/Project.js';
import { MIGRATIONS, runMigrations } from '../services/migrations.js';

beforeAll(connectTestDb);
beforeEach(resetDb);
afterAll(() => mongoose.disconnect());

describe('credits ×10 migration', () => {
  it('multiplies balances and the ledger once, even when run again', async () => {
    const ws = await Workspace.create({ name: 'Old', ownerId: new mongoose.Types.ObjectId(), creditBalance: 7 });
    await CreditTransaction.create({ workspaceId: ws._id, type: 'grant', amount: 7, balanceAfter: 7, idempotencyKey: `t:${ws._id}`, status: 'applied' });
    await CreditTransaction.create({ workspaceId: ws._id, type: 'reserve', amount: -1, balanceAfter: null, idempotencyKey: `r:${ws._id}`, status: 'rejected' });
    await mongoose.connection.collection('migrations').deleteMany({});

    const x10 = MIGRATIONS.filter((m) => m.id === '2026-11-16-credits-x10');
    await runMigrations(x10);
    await runMigrations(x10); // second start-up: skipped

    expect((await Workspace.findById(ws._id))!.creditBalance).toBe(70);
    const tx = await CreditTransaction.find({ workspaceId: ws._id }).sort({ idempotencyKey: -1 }).lean();
    expect(tx.map((t) => [t.amount, t.balanceAfter])).toEqual([
      [70, 70],
      [-10, null],
    ]);
    const marker = await mongoose.connection.collection('migrations').findOne({ _id: '2026-11-16-credits-x10' as never });
    expect(marker).toMatchObject({ status: 'done' });
  });
});

describe('per-video prices migration', () => {
  it('multiplies balances and the ledger by 2.5 once, and fingerprints exported projects', async () => {
    const ws = await Workspace.create({ name: 'Old', ownerId: new mongoose.Types.ObjectId(), creditBalance: 70 });
    await CreditTransaction.create({ workspaceId: ws._id, type: 'grant', amount: 70, balanceAfter: 70, idempotencyKey: `t2:${ws._id}`, status: 'applied' });
    const asset = new mongoose.Types.ObjectId();
    const p = await Project.create({ workspaceId: ws._id, createdBy: new mongoose.Types.ObjectId(), title: 'Old video', mode: 'editor', sourceAssetId: asset, outputAssetId: new mongoose.Types.ObjectId() });
    await mongoose.connection.collection('migrations').deleteMany({});
    const m = MIGRATIONS.filter((x) => x.id === '2026-11-23-per-video-prices');
    await runMigrations(m);
    await runMigrations(m);
    expect((await Workspace.findById(ws._id))!.creditBalance).toBe(175);
    expect((await CreditTransaction.findOne({ workspaceId: ws._id }).lean())).toMatchObject({ amount: 175, balanceAfter: 175 });
    expect((await Project.findById(p._id))!.exportedFor).toBe(`src:${asset.toString()}`);
  });
});
