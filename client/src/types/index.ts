export type CreationMode = 'ai_editor' | 'ai_avatar' | 'faceless';
export type ProjectStatus = 'draft' | 'queued' | 'transcribing' | 'analyzing' | 'rendering' | 'ready' | 'failed';
export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:5';
export type Resolution = '720p' | '1080p' | '4k';
export type EditingStyle = 'Podcast' | 'Cinematic' | 'Viral' | 'Educational' | 'Business' | 'Storytelling' | 'Vlog';
export type PlanTier = 'free' | 'starter' | 'creator' | 'pro' | 'agency';

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

export interface IBrandKit {
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  captionStyle: string;
  watermarkUrl?: string;
  watermarkPosition: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: 'super_admin' | 'admin' | 'customer' | 'team_member';
  creditBalance: number;
  planTier: PlanTier;
  workspaceId: string;
  brandKit?: IBrandKit;
}

export interface Project {
  _id: string;
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
  creditsCost: number;
  scenes?: IScene[];
  transcription?: IWordTimestamp[];
  editingPreferences?: {
    editingStyle: EditingStyle;
    captionStyle: string;
    captionPosition: string;
    highlightKeywords: boolean;
    removePauses: boolean;
    brollIntensity: string;
    zoomIntensity: string;
    backgroundMusic: string;
    musicVolume: number;
    autoDucking: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Template {
  _id: string;
  title: string;
  category: string;
  description: string;
  aspectRatio: '9:16' | '16:9';
  captionStyle: string;
  highlightColor: string;
  fontFamily: string;
  zoomIntensity: string;
  brollIntensity: string;
  suggestedMusicCategory: string;
  isPremium: boolean;
  tags: string[];
}

export interface CreditTransaction {
  _id: string;
  amount: number;
  balanceAfter: number;
  operation: string;
  description: string;
  createdAt: string;
}
