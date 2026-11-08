import { Types } from 'mongoose';
import { CreditTransaction, CREDIT_TX_TYPES } from '../models/CreditTransaction.js';
import { Workspace } from '../models/Workspace.js';
import { AppError } from '../utils/errors.js';

type TxType = (typeof CREDIT_TX_TYPES)[number];

export interface CreditChange {
  workspaceId: Types.ObjectId | string;
  type: TxType;
  /** Signed amount. Negative values require sufficient balance. */
  amount: number;
  idempotencyKey: string;
  note?: string;
  reference?: { kind: string; id: string };
  actorId?: Types.ObjectId | string | null;
}

export interface CreditResult {
  applied: boolean;
  /** True when this idempotency key was already processed earlier. */
  duplicate: boolean;
  balanceAfter: number | null;
}

/**
 * Applies a credit change exactly once per idempotency key.
 *
 * 1. Insert a `pending` ledger row (unique key) — a duplicate means the change was already
 *    requested, so we return the earlier outcome instead of applying it twice.
 * 2. Atomically `$inc` the workspace balance; debits are conditional on `creditBalance >= -amount`,
 *    so concurrent spends can never drive the balance negative.
 * 3. Mark the row applied/rejected.
 *
 * Phase 5 wraps steps 1–3 in a MongoDB transaction (requires a replica set, as on Atlas) and adds
 * a reconciliation job for rows left `pending` by a crash between steps.
 */
export async function applyCreditChange(change: CreditChange): Promise<CreditResult> {
  if (!Number.isInteger(change.amount) || change.amount === 0) {
    throw new AppError(400, 'INVALID_AMOUNT', 'Credit amount must be a non-zero integer.');
  }

  let tx;
  try {
    tx = await CreditTransaction.create({
      workspaceId: change.workspaceId,
      type: change.type,
      amount: change.amount,
      idempotencyKey: change.idempotencyKey,
      note: change.note ?? '',
      reference: change.reference ?? { kind: null, id: null },
      actorId: change.actorId ?? null,
      status: 'pending',
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const existing = await CreditTransaction.findOne({ idempotencyKey: change.idempotencyKey }).lean();
      return { applied: existing?.status === 'applied', duplicate: true, balanceAfter: existing?.balanceAfter ?? null };
    }
    throw err;
  }

  const filter: Record<string, unknown> = { _id: change.workspaceId };
  if (change.amount < 0) filter.creditBalance = { $gte: -change.amount };

  const ws = await Workspace.findOneAndUpdate(filter, { $inc: { creditBalance: change.amount } }, { new: true });

  if (!ws) {
    await CreditTransaction.updateOne({ _id: tx._id }, { status: 'rejected' });
    throw new AppError(402, 'INSUFFICIENT_CREDITS', 'Not enough credits for this action.');
  }

  await CreditTransaction.updateOne({ _id: tx._id }, { status: 'applied', balanceAfter: ws.creditBalance });
  return { applied: true, duplicate: false, balanceAfter: ws.creditBalance };
}
