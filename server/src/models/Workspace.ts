import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { PLAN_IDS } from '../config/plans.js';

const memberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'admin', 'member'], required: true },
    addedAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

/**
 * The tenant boundary. Credits, storage, plan and projects belong to a workspace, so a later
 * "team" feature only adds members instead of migrating data.
 */
const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [memberSchema], default: [] },
    plan: { type: String, enum: PLAN_IDS, default: 'free', required: true },
    creditBalance: { type: Number, default: 0, min: 0, required: true },
    storageBytesUsed: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

workspaceSchema.index({ ownerId: 1 });
workspaceSchema.index({ 'members.userId': 1 });

export type WorkspaceDoc = HydratedDocument<InferSchemaType<typeof workspaceSchema>>;
export const Workspace = model('Workspace', workspaceSchema);
