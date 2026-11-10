import { Schema, model, type HydratedDocument, type InferSchemaType, Types } from 'mongoose';

export const CUSTOM_VOICE_STATUSES = ['awaiting_consent', 'cloning', 'ready', 'failed', 'revoked'] as const;

/** A workspace-owned cloned voice. Only usable while its consent record is active. */
const customVoiceSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    consentRecordId: { type: Schema.Types.ObjectId, ref: 'ConsentRecord', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    language: { type: String, default: 'en', maxlength: 10 },
    description: { type: String, default: '', maxlength: 200 },
    sampleAssetIds: { type: [Schema.Types.ObjectId], ref: 'Asset', default: [] },
    sampleDurationSec: { type: Number, default: 0 },
    provider: { type: String, default: null },
    providerVoiceId: { type: String, default: null },
    status: { type: String, enum: CUSTOM_VOICE_STATUSES, required: true },
    failureReason: { type: String, default: null, maxlength: 300 },
    lastJobId: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

customVoiceSchema.index({ workspaceId: 1, deletedAt: 1, createdAt: -1 });
customVoiceSchema.index({ workspaceId: 1, providerVoiceId: 1 });

export type CustomVoiceDoc = HydratedDocument<InferSchemaType<typeof customVoiceSchema>>;
export const CustomVoice = model('CustomVoice', customVoiceSchema);

export function toPublicCustomVoice(v: CustomVoiceDoc) {
  return {
    id: (v._id as Types.ObjectId).toString(),
    name: v.name,
    language: v.language,
    description: v.description,
    status: v.status,
    failureReason: v.failureReason,
    /** The id used as a project's voiceId once ready. */
    voiceId: v.status === 'ready' ? v.providerVoiceId : null,
    sampleCount: v.sampleAssetIds.length,
    sampleDurationSec: v.sampleDurationSec,
    createdAt: v.get('createdAt') as Date,
  };
}
