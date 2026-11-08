import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDb, resetDb } from './helpers.js';
import { Workspace } from '../models/Workspace.js';
import { CreditTransaction } from '../models/CreditTransaction.js';
import { applyCreditChange } from '../services/credit.service.js';

beforeAll(connectTestDb);
beforeEach(resetDb);
afterAll(() => mongoose.disconnect());

const newWorkspace = (balance = 0) =>
  Workspace.create({ name: 'WS', ownerId: new mongoose.Types.ObjectId(), creditBalance: balance });

describe('credit ledger', () => {
  it('applies a change exactly once per idempotency key', async () => {
    const ws = await newWorkspace();
    const first = await applyCreditChange({ workspaceId: ws._id, type: 'grant', amount: 10, idempotencyKey: 'k1' });
    const retry = await applyCreditChange({ workspaceId: ws._id, type: 'grant', amount: 10, idempotencyKey: 'k1' });
    expect(first).toMatchObject({ applied: true, duplicate: false, balanceAfter: 10 });
    expect(retry).toMatchObject({ applied: true, duplicate: true, balanceAfter: 10 });
    expect((await Workspace.findById(ws._id))!.creditBalance).toBe(10);
    expect(await CreditTransaction.countDocuments()).toBe(1);
  });

  it('rejects debits beyond the balance and records the rejection', async () => {
    const ws = await newWorkspace(2);
    await expect(
      applyCreditChange({ workspaceId: ws._id, type: 'consume', amount: -5, idempotencyKey: 'd1' }),
    ).rejects.toMatchObject({ status: 402, code: 'INSUFFICIENT_CREDITS' });
    expect((await Workspace.findById(ws._id))!.creditBalance).toBe(2);
    expect((await CreditTransaction.findOne({ idempotencyKey: 'd1' }))!.status).toBe('rejected');
  });

  it('never goes negative under concurrent debits', async () => {
    const ws = await newWorkspace(5);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        applyCreditChange({ workspaceId: ws._id, type: 'consume', amount: -1, idempotencyKey: `c${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect((await Workspace.findById(ws._id))!.creditBalance).toBe(0);
  });

  it('rejects non-integer or zero amounts', async () => {
    const ws = await newWorkspace();
    await expect(applyCreditChange({ workspaceId: ws._id, type: 'grant', amount: 1.5, idempotencyKey: 'f' })).rejects.toBeTruthy();
    await expect(applyCreditChange({ workspaceId: ws._id, type: 'grant', amount: 0, idempotencyKey: 'z' })).rejects.toBeTruthy();
  });
});
