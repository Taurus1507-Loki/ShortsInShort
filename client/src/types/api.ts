export type Role = 'super_admin' | 'admin' | 'customer' | 'team_member';

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  emailVerified: boolean;
  avatarUrl: string | null;
  hasPassword: boolean;
  googleLinked: boolean;
  defaultWorkspaceId: string;
  createdAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  plan: PlanId;
  planName: string;
  creditBalance: number;
  storageBytesUsed: number;
  storageBytesLimit: number;
}

export type PlanId = 'free' | 'starter' | 'creator' | 'pro' | 'agency';
export interface Plan {
  id: PlanId;
  name: string;
  monthlyPricePaise: number;
  annualPricePaise: number;
  monthlyCredits: number;
  storageBytes: number;
  maxResolution: string;
  watermark: boolean;
  highlights: string[];
}

export interface Meta {
  currency: 'INR';
  plans: Plan[];
  auth: { google: boolean; emailVerificationRequired: boolean };
  emailDelivery: 'smtp' | 'dev-log';
  features: Record<'videoRendering' | 'transcription' | 'captions' | 'broll' | 'aiKeywords' | 'translation' | 'zooms' | 'brandKit' | 'music' | 'avatarStudio' | 'facelessCreator' | 'payments', boolean>;
  uploads: { maxBytes: number; maxSourceDurationSec: number; storage: 'local' | 's3' };
}

export interface Asset {
  id: string;
  kind: 'source_video' | 'render' | 'thumbnail';
  status: 'pending' | 'ready' | 'failed';
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean | null;
  projectId: string | null;
  thumbnailAssetId: string | null;
  createdAt: string;
}

export interface Job {
  id: string;
  type: string;
  status: 'queued' | 'active' | 'completed' | 'dead' | 'cancelled';
  stage: string;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Estimate {
  credits: number;
  balance: number;
  sourceDurationSec: number;
  resolution: string;
  resolutionAllowed: boolean;
  planMaxResolution: string;
}

export interface RenderStats {
  sourceDurationSec: number | null;
  outputDurationSec: number | null;
  silenceRemovedSec: number | null;
  cuts: number | null;
  creditsCharged: number | null;
  captionsAdded?: boolean;
  fillerWordsRemoved?: number;
  framing?: 'crop' | 'blur' | null;
  brollCount?: number;
  broll?: Array<{ start: number; end: number; query: string; provider: string; pageUrl: string; author: string }>;
  aiKeywords?: boolean;
  captionsTranslatedTo?: string | null;
  zoomCount?: number;
  logoApplied?: boolean;
  watermark?: boolean;
  music?: { title: string; artist: string; license: string } | null;
  warnings: string[];
}

export type ProjectMode = 'editor' | 'avatar' | 'faceless';
export type ProjectStatus = 'draft' | 'queued' | 'processing' | 'completed' | 'failed';
export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:5';
export type EditingStyle =
  | 'viral'
  | 'podcast'
  | 'cinematic'
  | 'educational'
  | 'business'
  | 'storytelling'
  | 'vlog'
  | 'product_promotion';
export type Intensity = 'low' | 'medium' | 'high';

export interface ProjectSettings {
  captionsEnabled: boolean;
  captionStyle: 'bold_pop' | 'clean_minimal' | 'karaoke' | 'boxed' | 'cinematic';
  captionPosition: 'top' | 'middle' | 'bottom';
  captionSize: 'small' | 'medium' | 'large' | 'xl';
  /** 'same' = captions in the spoken language. */
  captionLanguage: 'same' | 'en' | 'hi' | 'te' | 'ta' | 'mr';
  highlightColor: string;
  musicMood: 'auto' | 'none' | 'upbeat' | 'calm' | 'cinematic' | 'corporate' | 'lofi';
  bRollIntensity: 'none' | Intensity;
  editingIntensity: Intensity;
  /** Spoken language of the audio. */
  language: 'en' | 'hi' | 'te' | 'ta' | 'mr';
  framing: 'auto' | 'crop' | 'blur';
  zoomIntensity: 'off' | 'subtle' | 'dynamic';
  /** Overlay the Brand Kit logo on renders. */
  useBrandKit: boolean;
  targetDurationSec: number;
  resolution: '720p' | '1080p' | '4k';
}

export interface Project {
  id: string;
  title: string;
  mode: ProjectMode;
  status: ProjectStatus;
  aspectRatio: AspectRatio;
  style: EditingStyle;
  script: string;
  topic: string;
  settings: ProjectSettings;
  sourceAssetId: string | null;
  outputAssetId: string | null;
  lastJobId: string | null;
  lastError: string | null;
  lastRenderedAt: string | null;
  renderStats?: RenderStats;
  sourceAsset?: Asset | null;
  outputAsset?: Asset | null;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface DashboardSummary {
  plan: { id: PlanId; name: string; monthlyCredits: number; maxResolution: string };
  credits: { balance: number; usedThisMonth: number };
  projects: { total: number; byStatus: Record<ProjectStatus, number> };
  storage: { usedBytes: number; limitBytes: number };
  recentProjects: Project[];
}

export interface SessionInfo {
  id: string;
  userAgent: string;
  ip: string;
  method: 'password' | 'google';
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export interface BrandKit {
  logo: Asset | null;
  logoPosition: LogoPosition;
  logoSize: 'small' | 'medium' | 'large';
  logoOpacity: number;
  primaryColor: string;
  secondaryColor: string;
  captionStyle: ProjectSettings['captionStyle'];
  captionPosition: ProjectSettings['captionPosition'];
  captionSize: ProjectSettings['captionSize'];
  highlightColor: string;
  applyToNewProjects: boolean;
  updatedAt: string;
}
