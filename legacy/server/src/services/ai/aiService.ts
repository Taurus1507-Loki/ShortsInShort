import { getTranscriptionProvider } from './transcriptionProviders.js';
import { getTTSProvider } from './ttsProviders.js';
import { getAvatarProvider } from './avatarProviders.js';
import { getBrollProvider } from './brollProviders.js';
import { getLLMProvider } from './llmProviders.js';
import {
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionOptions,
  TTSProvider,
  TTSOptions,
  TTSVoice,
  AvatarProvider,
  CreateAvatarOptions,
  AvatarResult,
  AvatarGenerationOptions,
  AvatarVideoResult,
  BrollProvider,
  BrollSearchOptions,
  BrollResult,
  LLMProvider,
  LLMOptions,
} from './providerInterfaces.js';
import { config } from '../../config/env.js';

export class AIService {
  private transcriptionProvider: TranscriptionProvider;
  private ttsProvider: TTSProvider;
  private avatarProvider: AvatarProvider;
  private brollProvider: BrollProvider;
  private llmProvider: LLMProvider;

  constructor() {
    this.transcriptionProvider = getTranscriptionProvider();
    this.ttsProvider = getTTSProvider();
    this.avatarProvider = getAvatarProvider();
    this.brollProvider = getBrollProvider();
    this.llmProvider = getLLMProvider();
  }

  getTranscriptionProvider(): TranscriptionProvider { return this.transcriptionProvider; }
  getTTSProvider(): TTSProvider { return this.ttsProvider; }
  getAvatarProvider(): AvatarProvider { return this.avatarProvider; }
  getBrollProvider(): BrollProvider { return this.brollProvider; }
  getLLMProvider(): LLMProvider { return this.llmProvider; }

  async transcribe(filePath: string, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    return this.transcriptionProvider.transcribe(filePath, options);
  }

  async synthesizeSpeech(text: string, options: TTSOptions): Promise<Buffer> {
    return this.ttsProvider.synthesize(text, options);
  }

  async getVoices(): Promise<TTSVoice[]> {
    return this.ttsProvider.getVoices();
  }

  async createAvatar(options: CreateAvatarOptions): Promise<AvatarResult> {
    return this.avatarProvider.createAvatar(options);
  }

  async getAvatar(avatarId: string): Promise<AvatarResult | null> {
    return this.avatarProvider.getAvatar(avatarId);
  }

  async deleteAvatar(avatarId: string): Promise<void> {
    return this.avatarProvider.deleteAvatar(avatarId);
  }

  async generateAvatarVideo(options: AvatarGenerationOptions): Promise<AvatarVideoResult> {
    return this.avatarProvider.generateVideo(options);
  }

  async searchBroll(query: string, options: BrollSearchOptions): Promise<BrollResult[]> {
    return this.brollProvider.search(query, options);
  }

  async analyzeScript(script: string, options?: LLMOptions): Promise<ScriptAnalysisResult> {
    const schema = {
      type: 'object',
      properties: {
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number' },
              scriptChunk: { type: 'string' },
              durationEstimate: { type: 'number' },
              brollQuery: { type: 'string' },
              brollType: { type: 'string', enum: ['video', 'image', 'animation'] },
              transition: { type: 'string', enum: ['cut', 'fade', 'zoom_in', 'slide_left', 'wipe'] },
              visualDescription: { type: 'string' },
              hookType: { type: 'string', enum: ['question', 'statement', 'statistic', 'story', 'none'] },
            },
            required: ['index', 'scriptChunk', 'durationEstimate', 'brollQuery'],
          },
        },
        overallTone: { type: 'string' },
        targetPlatform: { type: 'string' },
        estimatedDuration: { type: 'number' },
      },
      required: ['scenes', 'overallTone', 'estimatedDuration'],
    };

    const prompt = `Analyze this script for a short-form video and break it into scenes with B-roll suggestions:\n\n${script}\n\nEach scene should be 3-8 seconds. Identify hooks, visual cues, and relevant B-roll search terms.`;

    return this.llmProvider.completeJson<ScriptAnalysisResult>(prompt, schema, options);
  }

  async improveScript(script: string, style: string, options?: LLMOptions): Promise<string> {
    const prompt = `Improve this script for a ${style} style short-form video. Make it punchy, engaging, and optimized for retention:\n\n${script}`;
    return this.llmProvider.complete(prompt, { ...options, temperature: 0.8 });
  }

  getProviderStatus() {
    return {
      transcription: { name: this.transcriptionProvider.name, configured: this.transcriptionProvider.isConfigured() },
      tts: { name: this.ttsProvider.name, configured: this.ttsProvider.isConfigured() },
      avatar: { name: this.avatarProvider.name, configured: this.avatarProvider.isConfigured() },
      broll: { name: this.brollProvider.name, configured: this.brollProvider.isConfigured() },
      llm: { name: this.llmProvider.name, configured: this.llmProvider.isConfigured() },
    };
  }
}

export interface ScriptAnalysisResult {
  scenes: Array<{
    index: number;
    scriptChunk: string;
    durationEstimate: number;
    brollQuery: string;
    brollType: 'video' | 'image' | 'animation';
    transition: 'cut' | 'fade' | 'zoom_in' | 'slide_left' | 'wipe';
    visualDescription: string;
    hookType: 'question' | 'statement' | 'statistic' | 'story' | 'none';
  }>;
  overallTone: string;
  targetPlatform: string;
  estimatedDuration: number;
}

let aiServiceInstance: AIService | null = null;

export function getAIService(): AIService {
  if (!aiServiceInstance) {
    aiServiceInstance = new AIService();
  }
  return aiServiceInstance;
}