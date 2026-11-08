import { Schema, model, type HydratedDocument, type InferSchemaType, Types } from 'mongoose';

export const PROJECT_MODES = ['editor', 'avatar', 'faceless'] as const;
export const PROJECT_STATUSES = ['draft', 'queued', 'processing', 'completed', 'failed'] as const;
export const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5'] as const;
export const EDITING_STYLES = [
  'viral',
  'podcast',
  'cinematic',
  'educational',
  'business',
  'storytelling',
  'vlog',
  'product_promotion',
] as const;
export const INTENSITIES = ['low', 'medium', 'high'] as const;
export const RESOLUTIONS = ['720p', '1080p', '4k'] as const;
export const CAPTION_POSITIONS = ['top', 'middle', 'bottom'] as const;

const settingsSchema = new Schema(
  {
    captionsEnabled: { type: Boolean, default: true },
    captionStyle: { type: String, default: 'bold_pop', maxlength: 40 },
    captionPosition: { type: String, enum: CAPTION_POSITIONS, default: 'bottom' },
    highlightColor: { type: String, default: '#A78BFA', match: /^#[0-9a-fA-F]{6}$/ },
    musicMood: { type: String, default: 'auto', maxlength: 40 },
    bRollIntensity: { type: String, enum: INTENSITIES, default: 'medium' },
    editingIntensity: { type: String, enum: INTENSITIES, default: 'medium' },
    language: { type: String, default: 'en', maxlength: 10 },
    targetDurationSec: { type: Number, min: 5, max: 3600, default: 60 },
    resolution: { type: String, enum: RESOLUTIONS, default: '1080p' },
  },
  { _id: false },
);

const projectSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    mode: { type: String, enum: PROJECT_MODES, required: true },
    status: { type: String, enum: PROJECT_STATUSES, default: 'draft', required: true },
    aspectRatio: { type: String, enum: ASPECT_RATIOS, default: '9:16', required: true },
    style: { type: String, enum: EDITING_STYLES, default: 'viral', required: true },
    script: { type: String, default: '', maxlength: 20000 },
    topic: { type: String, default: '', maxlength: 300 },
    settings: { type: settingsSchema, default: () => ({}) },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

projectSchema.index({ workspaceId: 1, deletedAt: 1, updatedAt: -1 });
projectSchema.index({ workspaceId: 1, deletedAt: 1, status: 1 });

export type ProjectDoc = HydratedDocument<InferSchemaType<typeof projectSchema>>;
export const Project = model('Project', projectSchema);

export function toPublicProject(p: ProjectDoc) {
  return {
    id: (p._id as Types.ObjectId).toString(),
    title: p.title,
    mode: p.mode,
    status: p.status,
    aspectRatio: p.aspectRatio,
    style: p.style,
    script: p.script,
    topic: p.topic,
    settings: p.settings,
    createdAt: p.get('createdAt') as Date,
    updatedAt: p.get('updatedAt') as Date,
  };
}
