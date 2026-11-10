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
/** Avatar Studio backgrounds behind the voiceover video. */
export const BACKGROUNDS = ['brand', 'color', 'image', 'video'] as const;
/** full = presenter fills the frame on a solid colour; overlay = presenter cut out over the background. */
export const AVATAR_LAYOUTS = ['full', 'overlay'] as const;

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
    /** Avatar Studio: provider voice id for the voiceover ('' = not chosen). */
    voiceId: { type: String, default: '', maxlength: 64 },
    /** 0.7–1.2, 1 = normal speaking speed. */
    speakingRate: { type: Number, min: 0.7, max: 1.2, default: 1 },
    /** brand = Brand Kit colour gradient; color = solid colour; image/video = uploaded file. */
    background: { type: String, enum: BACKGROUNDS, default: 'brand' },
    backgroundColor: { type: String, default: '#1E1B4B', match: /^#[0-9a-fA-F]{6}$/ },
    /** Small "AI-generated" label on the video (always on for cloned voices). */
    disclosure: { type: Boolean, default: true },
    /** Talking presenter (avatar provider look id); '' = voiceover video without a presenter. */
    avatarId: { type: String, default: '', maxlength: 100 },
    avatarLayout: { type: String, enum: AVATAR_LAYOUTS, default: 'full' },
  },
  { _id: false },
);

const captionLineSchema = new Schema(
  {
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    text: { type: String, required: true, maxlength: 160 },
    keyword: { type: String, default: '', maxlength: 60 },
  },
  { _id: false },
);

/** A licensed stock clip chosen for a faceless scene (download URL never sent to the browser). */
const stockClipSchema = new Schema(
  {
    id: String,
    provider: String,
    downloadUrl: String,
    pageUrl: String,
    author: String,
    width: Number,
    height: Number,
    durationSec: Number,
    thumbnailUrl: { type: String, default: null },
    tags: { type: [String], default: [] },
  },
  { _id: false },
);

const sceneSchema = new Schema(
  {
    /** The narration for this scene (a slice of the script, in order). */
    text: { type: String, required: true, maxlength: 1000 },
    /** Stock searches, most specific first. */
    queries: { type: [String], default: [] },
    clip: { type: stockClipSchema, default: null },
    /** Other relevant clips to swap in. */
    candidates: { type: [stockClipSchema], default: [] },
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
    /** Avatar Studio: background image or video asset. */
    backgroundAssetId: { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
    outputAssetId: { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
    lastJobId: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    lastError: { type: String, default: null, maxlength: 500 },
    lastRenderedAt: { type: Date, default: null },
    /** Caption lines of the last render, on the edited timeline. */
    captionLines: { type: [captionLineSchema], default: [] },
    /** Fingerprint of the cut those lines are timed against. */
    captionTimelineKey: { type: String, default: null },
    /** User-edited captions; applied on the next render only if the cut is unchanged. */
    captionOverrides: { type: [captionLineSchema], default: null },
    captionOverridesKey: { type: String, default: null },
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
      captionsFromEdits: { type: Boolean, default: false },
      zoomCount: { type: Number, default: 0 },
      logoApplied: { type: Boolean, default: false },
      watermark: { type: Boolean, default: false },
      disclosure: { type: Boolean, default: false },
      presenter: { type: { _id: false, avatarId: String, layout: String, reused: Boolean }, default: null },
      sceneCount: { type: Number, default: 0 },
      background: { type: String, default: null },
      music: { type: { _id: false, title: String, artist: String, license: String }, default: null },
      warnings: { type: [String], default: [] },
    },
    /**
     * The provider presenter clip for the current voiceover. Saved as soon as the provider accepts the
     * request so a retried job polls the same video instead of paying for a new one.
     */
    avatarRender: {
      type: {
        _id: false,
        provider: String,
        providerVideoId: String,
        avatarId: String,
        narrationAssetId: Schema.Types.ObjectId,
        backgroundColor: String,
        aspectRatio: String,
        assetId: { type: Schema.Types.ObjectId, default: null },
        status: String,
        requestedAt: Date,
      },
      default: null,
    },
    /** Faceless: scenes planned from the script (step 4.1) and the script fingerprint they match. */
    scenes: { type: [sceneSchema], default: [] },
    scenesKey: { type: String, default: null },
    /** How the scene searches were chosen: by AI, or from keywords when the AI wasn't available. */
    scenesPlannedWith: { type: String, enum: ['ai', 'keywords', null], default: null },
    /** Avatar Studio voiceover (step 3.1). */
    narrationAssetId: { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
    /** Word timings of the voiceover (used for captions in 3.3; never sent in full to the client). */
    narrationWords: { type: [{ _id: false, text: String, start: Number, end: Number }], default: [], select: false },
    narrationStats: {
      type: {
        _id: false,
        durationSec: Number,
        characters: Number,
        chunks: Number,
        wordCount: Number,
        timingsAvailable: Boolean,
        voiceId: String,
        voiceName: String,
        provider: String,
        model: String,
        language: String,
        creditsCharged: Number,
        scriptHash: String,
        createdAt: Date,
      },
      default: null,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

projectSchema.index({ workspaceId: 1, deletedAt: 1, updatedAt: -1 });
projectSchema.index({ workspaceId: 1, deletedAt: 1, status: 1 });

export type ProjectDoc = HydratedDocument<InferSchemaType<typeof projectSchema>>;
export const Project = model('Project', projectSchema);

const publicClip = (c: { id?: string | null; provider?: string | null; pageUrl?: string | null; author?: string | null; durationSec?: number | null; thumbnailUrl?: string | null; width?: number | null; height?: number | null }) => ({
  id: c.id, provider: c.provider, pageUrl: c.pageUrl, author: c.author, durationSec: c.durationSec, thumbnailUrl: c.thumbnailUrl ?? null, width: c.width, height: c.height,
});

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
    backgroundAssetId: p.backgroundAssetId?.toString() ?? null,
    outputAssetId: p.outputAssetId?.toString() ?? null,
    lastJobId: p.lastJobId?.toString() ?? null,
    lastError: p.lastError,
    lastRenderedAt: p.lastRenderedAt,
    renderStats: p.renderStats,
    captionLines: p.captionLines ?? [],
    captionsEdited: Boolean(p.captionOverrides?.length),
    /** The saved edits (shown in the editor instead of the generated lines). */
    captionOverrides: p.captionOverrides?.length ? p.captionOverrides : null,
    narrationAssetId: p.narrationAssetId?.toString() ?? null,
    narrationStats: p.narrationStats ?? null,
    scenes: (p.scenes ?? []).map((s) => ({
      text: s.text,
      queries: s.queries,
      clip: s.clip ? publicClip(s.clip) : null,
      candidates: (s.candidates ?? []).map(publicClip),
    })),
    scenesKey: p.scenesKey ?? null,
    scenesPlannedWith: p.scenesPlannedWith ?? null,
    createdAt: p.get('createdAt') as Date,
    updatedAt: p.get('updatedAt') as Date,
  };
}
