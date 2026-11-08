export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
  highlight?: boolean;
}

export interface TranscriptionResult {
  words: WordTimestamp[];
  language?: string;
  duration: number;
}

export interface TranscriptionProvider {
  name: string;
  transcribe(filePath: string, options?: TranscriptionOptions): Promise<TranscriptionResult>;
  isConfigured(): boolean;
}

export interface TranscriptionOptions {
  language?: string;
  prompt?: string;
  wordTimestamps?: boolean;
  diarization?: boolean;
}

export interface TTSVoice {
  id: string;
  name: string;
  language: string;
  gender?: 'male' | 'female' | 'neutral';
  previewUrl?: string;
  provider: string;
  isCustom?: boolean;
  createdAt?: Date;
}

export interface VoiceCloningOptions {
  name: string;
  audioFiles: Buffer[];
  description?: string;
  labels?: Record<string, string>;
}

export interface ClonedVoiceResult {
  voiceId: string;
  name: string;
  status: 'processing' | 'ready' | 'failed';
  previewUrl?: string;
  createdAt: Date;
}

export interface TTSProvider {
  name: string;
  synthesize(text: string, options: TTSOptions): Promise<Buffer>;
  getVoices(): Promise<TTSVoice[]>;
  isConfigured(): boolean;
  cloneVoice?(options: VoiceCloningOptions): Promise<ClonedVoiceResult>;
  deleteVoice?(voiceId: string): Promise<void>;
  getVoice?(voiceId: string): Promise<TTSVoice | null>;
}

export interface TTSOptions {
  voiceId: string;
  modelId?: string;
  language?: string;
  speed?: number;
  pitch?: number;
  outputFormat?: 'mp3' | 'wav' | 'pcm';
}

export interface AvatarProvider {
  name: string;
  generateVideo(options: AvatarGenerationOptions): Promise<AvatarVideoResult>;
  createAvatar(options: CreateAvatarOptions): Promise<AvatarResult>;
  getAvatar(avatarId: string): Promise<AvatarResult | null>;
  deleteAvatar(avatarId: string): Promise<void>;
  isConfigured(): boolean;
}

export interface CreateAvatarOptions {
  name: string;
  imageFile: Buffer;
  voiceFile?: Buffer;
  consentRecordId: string;
}

export interface AvatarResult {
  id: string;
  name: string;
  previewImageUrl?: string;
  status: 'processing' | 'ready' | 'failed';
  createdAt: Date;
}

export interface AvatarGenerationOptions {
  avatarId: string;
  script: string;
  voiceId?: string;
  language?: string;
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
  resolution: '720p' | '1080p' | '4k';
  backgroundUrl?: string;
}

export interface AvatarVideoResult {
  videoUrl: string;
  duration: number;
  thumbnailUrl?: string;
}

export interface BrollProvider {
  name: string;
  search(query: string, options: BrollSearchOptions): Promise<BrollResult[]>;
  isConfigured(): boolean;
}

export interface BrollSearchOptions {
  orientation: 'portrait' | 'landscape' | 'square';
  duration?: { min: number; max: number };
  count?: number;
  category?: string;
}

export interface BrollResult {
  id: string;
  videoUrl: string;
  previewUrl: string;
  duration: number;
  author: string;
  license: 'cc0' | 'royalty-free' | 'custom';
  tags: string[];
}

export interface LLMProvider {
  name: string;
  complete(prompt: string, options?: LLMOptions): Promise<string>;
  completeJson<T>(prompt: string, schema: any, options?: LLMOptions): Promise<T>;
  isConfigured(): boolean;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  model?: string;
}