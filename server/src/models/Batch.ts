import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from 'mongoose';

/**
 * Batch create: many Faceless videos from one template and voice, one per script. Each video is an
 * ordinary project that runs voiceover → scenes → export on its own (autopilot); the batch groups them.
 */
const batchSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 120 },
    templateId: { type: String, default: null },
    projectIds: { type: [Schema.Types.ObjectId], ref: 'Project', default: [] },
    /** Credits estimated when the batch started (voiceovers + exports). */
    estimatedCredits: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type BatchAttrs = InferSchemaType<typeof batchSchema>;
export type BatchDoc = HydratedDocument<BatchAttrs>;
export const Batch = model('Batch', batchSchema);

export function toPublicBatch(b: BatchDoc) {
  return {
    id: (b._id as Types.ObjectId).toString(),
    name: b.name,
    templateId: b.templateId,
    projectIds: b.projectIds.map((id) => id.toString()),
    estimatedCredits: b.estimatedCredits,
    createdAt: b.get('createdAt') as Date,
  };
}
