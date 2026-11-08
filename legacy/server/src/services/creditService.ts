import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { CreditTransaction, CreditOperation } from '../models/CreditTransaction.js';

export class InsufficientCreditsError extends Error {
  constructor(required: number, available: number) {
    super(`Insufficient video credits. Required: ${required}, Available: ${available}`);
    this.name = 'InsufficientCreditsError';
  }
}

export class CreditService {
  /**
   * Atomically deducts credits with balance verification and writes an audit ledger entry.
   */
  static async deductCredits(params: {
    userId: string | mongoose.Types.ObjectId;
    workspaceId: string | mongoose.Types.ObjectId;
    amount: number;
    operation: CreditOperation;
    description: string;
    projectId?: string | mongoose.Types.ObjectId;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; newBalance: number; transactionId: string }> {
    const { userId, workspaceId, amount, operation, description, projectId, idempotencyKey } = params;

    if (amount <= 0) {
      throw new Error('Deduction amount must be strictly positive');
    }

    // Idempotency check: prevent duplicate billing on retry
    if (idempotencyKey) {
      const existing = await CreditTransaction.findOne({ idempotencyKey });
      if (existing) {
        return {
          success: true,
          newBalance: existing.balanceAfter,
          transactionId: existing._id.toString(),
        };
      }
    }

    // Atomically find user with sufficient balance and decrement
    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, creditBalance: { $gte: amount } },
      { $inc: { creditBalance: -amount } },
      { new: true }
    );

    if (!updatedUser) {
      const currentUser = await User.findById(userId);
      const available = currentUser ? currentUser.creditBalance : 0;
      throw new InsufficientCreditsError(amount, available);
    }

    const transaction = await CreditTransaction.create({
      userId,
      workspaceId,
      projectId,
      amount: -amount,
      balanceAfter: updatedUser.creditBalance,
      operation,
      description,
      idempotencyKey,
    });

    return {
      success: true,
      newBalance: updatedUser.creditBalance,
      transactionId: transaction._id.toString(),
    };
  }

  /**
   * Refunds credits (e.g. if an FFmpeg or AI generation job fails)
   */
  static async refundCredits(params: {
    userId: string | mongoose.Types.ObjectId;
    workspaceId: string | mongoose.Types.ObjectId;
    amount: number;
    description: string;
    projectId?: string | mongoose.Types.ObjectId;
    idempotencyKey?: string;
  }): Promise<{ newBalance: number }> {
    const { userId, workspaceId, amount, description, projectId, idempotencyKey } = params;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { creditBalance: amount } },
      { new: true }
    );

    if (!updatedUser) {
      throw new Error('User not found for credit refund');
    }

    await CreditTransaction.create({
      userId,
      workspaceId,
      projectId,
      amount,
      balanceAfter: updatedUser.creditBalance,
      operation: 'failed_job_refund',
      description,
      idempotencyKey,
    });

    return { newBalance: updatedUser.creditBalance };
  }

  static async getBalance(userId: string): Promise<number> {
    const user = await User.findById(userId).select('creditBalance');
    return user ? user.creditBalance : 0;
  }

  static async getHistory(userId: string, limit = 20, skip = 0) {
    return CreditTransaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .lean();
  }
}

