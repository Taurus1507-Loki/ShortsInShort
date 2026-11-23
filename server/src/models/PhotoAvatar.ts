import { Schema, model, type HydratedDocument, type InferSchemaType, Types } from 'mongoose';

export const PHOTO_AVATAR_STATUSES = ['awaiting_consent', 'creating', 'ready', 'failed', 'revoked'] as const;

/**
 * A workspace-owned talking avatar made from one photo of a real person (personal branding). Only
 * usable while its consent record (kind "likeness") is active; withdrawing consent deletes the photo
 * and the avatar at the provider.
 */
const photoAvatarSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    consentRecordId: { type: Schema.Types.ObjectId, ref: 'ConsentRecord', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    photoAssetId: { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
    provider: { type: String, default: null },
    providerGroupId: { type: String, default: null },
    /** The provider's look id: used as a project's `settings.avatarId` once ready. */
    providerLookId: { type: String, default: null },
    previewImageUrl: { type: String, default: null },
    status: { type: String, enum: PHOTO_AVATAR_STATUSES, required: true },
    failureReason: { type: String, default: null, maxlength: 300 },
    lastJobId: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

photoAvatarSchema.index({ workspaceId: 1, deletedAt: 1, createdAt: -1 });
photoAvatarSchema.index({ workspaceId: 1, providerLookId: 1 });

export type PhotoAvatarDoc = HydratedDocument<InferSchemaType<typeof photoAvatarSchema>>;
export const PhotoAvatar = model('PhotoAvatar', photoAvatarSchema);

export function toPublicPhotoAvatar(a: PhotoAvatarDoc) {
  return {
    id: (a._id as Types.ObjectId).toString(),
    name: a.name,
    status: a.status,
    failureReason: a.failureReason,
    /** The id to use as a project's presenter once ready. */
    avatarId: a.status === 'ready' ? a.providerLookId : null,
    previewImageUrl: a.previewImageUrl,
    photoAssetId: a.photoAssetId?.toString() ?? null,
    createdAt: a.get('createdAt') as Date,
  };
}
