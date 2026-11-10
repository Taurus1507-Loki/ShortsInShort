import { Schema, model, type HydratedDocument, type InferSchemaType, Types } from 'mongoose';

export const ASSET_KINDS = ['source_video', 'render', 'thumbnail', 'brand_logo', 'narration_audio', 'voice_sample', 'consent_recording'] as const;
export const ASSET_STATUSES = ['pending', 'ready', 'failed'] as const;

/** A file in object storage owned by a workspace. Bytes live in storage; this is the index. */
const assetSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    kind: { type: String, enum: ASSET_KINDS, required: true },
    status: { type: String, enum: ASSET_STATUSES, default: 'pending', required: true },
    storageKey: { type: String, required: true },
    originalName: { type: String, default: '', maxlength: 255 },
    mimeType: { type: String, required: true, maxlength: 100 },
    declaredSizeBytes: { type: Number, default: 0 },
    sizeBytes: { type: Number, default: 0 },
    durationSec: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    hasAudio: { type: Boolean, default: null },
    thumbnailAssetId: { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
    /** Counted against workspace storage once ready. */
    countedBytes: { type: Number, default: 0 },
    failureReason: { type: String, default: null, maxlength: 300 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

assetSchema.index({ workspaceId: 1, deletedAt: 1, kind: 1, createdAt: -1 });
assetSchema.index({ storageKey: 1 }, { unique: true });
// Abandoned pending uploads are cleaned up by the sweeper.
assetSchema.index({ status: 1, createdAt: 1 });

export type AssetDoc = HydratedDocument<InferSchemaType<typeof assetSchema>>;
export const Asset = model('Asset', assetSchema);

export function toPublicAsset(a: AssetDoc) {
  return {
    id: (a._id as Types.ObjectId).toString(),
    kind: a.kind,
    status: a.status,
    originalName: a.originalName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    durationSec: a.durationSec,
    width: a.width,
    height: a.height,
    hasAudio: a.hasAudio,
    projectId: a.projectId?.toString() ?? null,
    thumbnailAssetId: a.thumbnailAssetId?.toString() ?? null,
    createdAt: a.get('createdAt') as Date,
  };
}
