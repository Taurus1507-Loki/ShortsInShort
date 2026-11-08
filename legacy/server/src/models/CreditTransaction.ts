import mongoose, { Schema, Document } from 'mongoose';

export type CreditOperation =
  | 'generation_deduct'
  | 'avatar_generation'
  | 'monthly_grant'
  | 'purchase_topup'
  | 'failed_job_refund'
  | 'admin_adjustment';

export interface ICreditTransaction extends Document {
  userId: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  projectId?: mongoose.Types.ObjectId;
  amount: number; // Negative for deductions, positive for credits added
  balanceAfter: number;
  operation: CreditOperation;
  description: string;
  idempotencyKey?: string;
  createdAt: Date;
}

const CreditTransactionSchema = new Schema<ICreditTransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    operation: {
      type: String,
      enum: ['generation_deduct', 'avatar_generation', 'monthly_grant', 'purchase_topup', 'failed_job_refund', 'admin_adjustment'],
      required: true,
      index: true,
    },
    description: { type: String, required: true },
    idempotencyKey: { type: String, sparse: true, unique: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

CreditTransactionSchema.index({ userId: 1, createdAt: -1 });

export const CreditTransaction = mongoose.model<ICreditTransaction>('CreditTransaction', CreditTransactionSchema);

