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
export const BROLL_INTENSITIES = ['none', 'low', 'medium', 'high'] as const;
export const RESOLUTIONS = ['720p', '1080p', '4k'] as const;
export const CAPTION_POSITIONS = ['top', 'middle', 'bottom'] as const;
export const CAPTION_SIZES = ['small', 'medium', 'large', 'xl'] as const;
/** How the source fills a different-shaped frame: auto chooses per video. */
export const FRAMINGS = ['auto', 'crop', 'blur'] as const;
export const ZOOM_INTENSITIES = ['off', 'subtle', 'dynamic'] as const;

const settingsSchema = new Schema(
  {
    captionsEnabled: { type: Boolean, default: true },
    captionStyle: { type: String, default: 'bold_pop', maxlength: 40 },
    captionPosition: { type: String, enum: CAPTION_POSITIONS, default: 'bottom' },
    captionSize: { type: String, enum: CAPTION_SIZES, default: 'medium' },
    /** 'same' = captions in the spoken language; another code = translated captions. */
    captionLanguage: { type: String, default: 'same', maxlength: 10 },
    highlightColor: { type: String, default: '#A78BFA', match: /^#[0-9a-fA-F]{6}$/ },
    musicMood: { type: String, default: 'auto', maxlength: 40 },
    bRollIntensity: { type: String, enum: BROLL_INTENSITIES, default: 'medium' },
    editingIntensity: { type: String, enum: INTENSITIES, default: 'medium' },
    /** Spoken language of the audio (drives transcription). */
    language: { type: String, default: 'en', maxlength: 10 },
    framing: { type: String, enum: FRAMINGS, default: 'auto' },
    zoomIntensity: { type: String, enum: ZOOM_INTENSITIES, default: 'subtle' },
    /** Overlay the workspace Brand Kit logo on renders. */
    useBrandKit: { type: Boolean, default: true },
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
    sourceAssetId: { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
    outputAssetId: { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
    lastJobId: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    lastError: { type: String, default: null, maxlength: 500 },
    lastRenderedAt: { type: Date, default: null },
    /** Facts about the last successful render (shown to the user). */
    renderStats: {
      sourceDurationSec: { type: Number, default: null },
      outputDurationSec: { type: Number, default: null },
      silenceRemovedSec: { type: Number, default: null },
      cuts: { type: Number, default: null },
      creditsCharged: { type: Number, default: null },
      captionsAdded: { type: Boolean, default: false },
      fillerWordsRemoved: { type: Number, default: 0 },
      framing: { type: String, default: null },
      brollCount: { type: Number, default: 0 },
      broll: {
        type: [{ _id: false, start: Number, end: Number, query: String, provider: String, pageUrl: String, author: String }],
        default: [],
      },
      aiKeywords: { type: Boolean, default: false },
      captionsTranslatedTo: { type: String, default: null },
      zoomCount: { type: Number, default: 0 },
      logoApplied: { type: Boolean, default: false },
      watermark: { type: Boolean, default: false },
      music: { type: { _id: false, title: String, artist: String, license: String }, default: null },
      warnings: { type: [String], default: [] },
    },
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
    sourceAssetId: p.sourceAssetId?.toString() ?? null,
    outputAssetId: p.outputAssetId?.toString() ?? null,
    lastJobId: p.lastJobId?.toString() ?? null,
    lastError: p.lastError,
    lastRenderedAt: p.lastRenderedAt,
    renderStats: p.renderStats,
    createdAt: p.get('createdAt') as Date,
    updatedAt: p.get('updatedAt') as Date,
  };
}
