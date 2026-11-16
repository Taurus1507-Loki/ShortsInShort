import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, resetDb } from './helpers.js';
import { Workspace } from '../models/Workspace.js';
import { CreditTransaction } from '../models/CreditTransaction.js';
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

    await runMigrations(MIGRATIONS);
    await runMigrations(MIGRATIONS); // second start-up: skipped

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
