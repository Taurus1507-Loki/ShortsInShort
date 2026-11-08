import { Schema, model, type InferSchemaType } from 'mongoose';

export const CREDIT_TX_TYPES = ['grant', 'reserve', 'consume', 'refund', 'adjust', 'purchase'] as const;

/** Append-only credit ledger. `idempotencyKey` is unique, so a retried operation can't apply twice. */
const creditTransactionSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    type: { type: String, enum: CREDIT_TX_TYPES, required: true },
    /** Signed: positive adds credits, negative removes them. */
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, default: null },
    idempotencyKey: { type: String, required: true, maxlength: 200 },
    status: { type: String, enum: ['pending', 'applied', 'rejected'], default: 'pending' },
    reference: {
      kind: { type: String, default: null },
      id: { type: String, default: null },
    },
    note: { type: String, default: '', maxlength: 300 },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

creditTransactionSchema.index({ idempotencyKey: 1 }, { unique: true });
creditTransactionSchema.index({ workspaceId: 1, createdAt: -1 });

export type CreditTransactionAttrs = InferSchemaType<typeof creditTransactionSchema>;
export const CreditTransaction = model('CreditTransaction', creditTransactionSchema);
