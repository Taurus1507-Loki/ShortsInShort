import mongoose, { Schema, Document } from 'mongoose';

export type CreationMode = 'ai_editor' | 'ai_avatar' | 'faceless';
export type ProjectStatus = 'draft' | 'queued' | 'transcribing' | 'analyzing' | 'rendering' | 'ready' | 'failed';
export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:5';
export type Resolution = '720p' | '1080p' | '4k';
export type EditingStyle = 'Podcast' | 'Cinematic' | 'Viral' | 'Educational' | 'Business' | 'Storytelling' | 'Vlog';

export interface IWordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
  highlight: boolean;
}

export interface IScene {
  index: number;
  startMs: number;
  endMs: number;
  scriptChunk: string;
  brollQuery?: string;
  brollMediaUrl?: string;
  brollType?: 'video' | 'image' | 'avatar' | 'raw';
  transition: 'cut' | 'fade' | 'zoom_in' | 'slide_left' | 'wipe';
  captionText?: string;
}

export interface IEditingPreferences {
  editingStyle: EditingStyle;
  captionStyle: string;
  captionPosition: 'top' | 'middle' | 'bottom';
  highlightKeywords: boolean;
  removePauses: boolean;
  silenceThresholdDb: number;
  minSilenceDurationMs: number;
  brollIntensity: 'none' | 'low' | 'medium' | 'high';
  zoomIntensity: 'none' | 'subtle' | 'dynamic';
  backgroundMusic: string;
  musicVolume: number;
  autoDucking: boolean;
}

export interface IProject extends Document {
  userId: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  title: string;
  creationMode: CreationMode;
  status: ProjectStatus;
  progress: number;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  rawVideoUrl?: string;
  outputVideoUrl?: string;
  thumbnailUrl?: string;
  duration: number;
  script?: string;
  editingPreferences: IEditingPreferences;
  scenes: IScene[];
  transcription: IWordTimestamp[];
  creditsCost: number;
  renderJobId?: string;
  renderError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, required: true, trim: true },
    creationMode: {
      type: String,
      enum: ['ai_editor', 'ai_avatar', 'faceless'],
      default: 'ai_editor',
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'queued', 'transcribing', 'analyzing', 'rendering', 'ready', 'failed'],
      default: 'draft',
      index: true,
    },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    aspectRatio: {
      type: String,
      enum: ['9:16', '16:9', '1:1', '4:5'],
      default: '9:16',
    },
    resolution: {
      type: String,
      enum: ['720p', '1080p', '4k'],
      default: '1080p',
    },
    rawVideoUrl: { type: String },
    outputVideoUrl: { type: String },
    thumbnailUrl: { type: String },
    duration: { type: Number, default: 0 },
    script: { type: String },
    editingPreferences: {
      editingStyle: {
        type: String,
        enum: ['Podcast', 'Cinematic', 'Viral', 'Educational', 'Business', 'Storytelling', 'Vlog'],
        default: 'Viral',
      },
      captionStyle: { type: String, default: 'karaoke_neon' },
      captionPosition: { type: String, enum: ['top', 'middle', 'bottom'], default: 'middle' },
      highlightKeywords: { type: Boolean, default: true },
      removePauses: { type: Boolean, default: true },
      silenceThresholdDb: { type: Number, default: -30 },
      minSilenceDurationMs: { type: Number, default: 450 },
      brollIntensity: { type: String, enum: ['none', 'low', 'medium', 'high'], default: 'medium' },
      zoomIntensity: { type: String, enum: ['none', 'subtle', 'dynamic'], default: 'subtle' },
      backgroundMusic: { type: String, default: 'energetic_lofi' },
      musicVolume: { type: Number, default: 15 },
      autoDucking: { type: Boolean, default: true },
    },
    scenes: [
      {
        index: Number,
        startMs: Number,
        endMs: Number,
        scriptChunk: String,
        brollQuery: String,
        brollMediaUrl: String,
        brollType: { type: String, enum: ['video', 'image', 'avatar', 'raw'], default: 'raw' },
        transition: {
          type: String,
          enum: ['cut', 'fade', 'zoom_in', 'slide_left', 'wipe'],
          default: 'cut',
        },
        captionText: String,
      },
    ],
    transcription: [
      {
        word: String,
        startMs: Number,
        endMs: Number,
        confidence: Number,
        highlight: Boolean,
      },
    ],
    creditsCost: { type: Number, default: 1 },
    renderJobId: { type: String },
    renderError: { type: String },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying user projects ordered by recency
ProjectSchema.index({ userId: 1, createdAt: -1 });
ProjectSchema.index({ workspaceId: 1, status: 1 });

export const Project = mongoose.model<IProject>('Project', ProjectSchema);

