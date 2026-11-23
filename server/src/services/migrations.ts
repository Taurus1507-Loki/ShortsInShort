import mongoose from 'mongoose';
import { logger } from '../config/logger.js';
import { Workspace } from '../models/Workspace.js';
import { CreditTransaction } from '../models/CreditTransaction.js';
import { Payment } from '../models/Billing.js';
import { Job } from '../models/Job.js';
import { Project } from '../models/Project.js';

/**
 * One-off data migrations, run at API start-up. Each runs at most once per database: its marker is
 * inserted first with a unique id, so a second instance starting at the same time skips it.
 */
interface Migration {
  id: string;
  run: () => Promise<Record<string, number>>;
}

const num = { $type: 'number' } as const;

/**
 * 2026-11-16: credits were rescaled 10× (Starter ₹499 = 200 credits instead of 20) so each step can be
 * priced fairly. Balances, the ledger, payments, pending job refunds and the "credits charged" shown on
 * projects are multiplied, so history and balances stay consistent.
 */
const creditsX10: Migration = {
  id: '2026-11-16-credits-x10',
  run: async () => {
    const r = await Promise.all([
      Workspace.updateMany({ creditBalance: num }, { $mul: { creditBalance: 10 } }),
      CreditTransaction.updateMany({ amount: num }, { $mul: { amount: 10 } }),
      CreditTransaction.updateMany({ balanceAfter: num }, { $mul: { balanceAfter: 10 } }),
      Payment.updateMany({ credits: num }, { $mul: { credits: 10 } }),
      Job.updateMany({ 'payload.credits': num }, { $mul: { 'payload.credits': 10 } }),
      Project.updateMany({ 'renderStats.creditsCharged': num }, { $mul: { 'renderStats.creditsCharged': 10 } }),
      Project.updateMany({ 'narrationStats.creditsCharged': num }, { $mul: { 'narrationStats.creditsCharged': 10 } }),
    ]);
    const names = ['workspaces', 'ledger', 'ledgerBalances', 'payments', 'jobs', 'renders', 'narrations'];
    return Object.fromEntries(r.map((x, i) => [names[i]!, x.modifiedCount]));
  },
};

/**
 * 2026-11-23: workspaces can keep several brand kits. Existing kits become the default "Main brand",
 * and the old one-kit-per-workspace unique index is dropped.
 */
const brandKits: Migration = {
  id: '2026-11-23-brand-kits',
  run: async () => {
    const col = mongoose.connection.collection('brandkits');
    let dropped = 0;
    try {
      await col.dropIndex('workspaceId_1');
      dropped = 1;
    } catch {
      /* already gone or never created */
    }
    const r = await col.updateMany({ isDefault: { $exists: false } }, { $set: { isDefault: true, name: 'Main brand' } });
    return { droppedIndex: dropped, kits: r.modifiedCount };
  },
};

export const MIGRATIONS: Migration[] = [creditsX10, brandKits];

export async function runMigrations(migrations: Migration[] = MIGRATIONS) {
  const col = mongoose.connection.collection<{ _id: string; status: string; startedAt: Date; finishedAt?: Date; result?: unknown }>('migrations');
  for (const m of migrations) {
    try {
      await col.insertOne({ _id: m.id, status: 'running', startedAt: new Date() });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        const done = await col.findOne({ _id: m.id });
        if (done?.status !== 'done') logger.warn({ migration: m.id }, 'Migration was started earlier but never finished: check the data');
        continue;
      }
      throw err;
    }
    const result = await m.run();
    await col.updateOne({ _id: m.id }, { $set: { status: 'done', finishedAt: new Date(), result } });
    logger.info({ migration: m.id, result }, 'Migration applied');
  }
}
