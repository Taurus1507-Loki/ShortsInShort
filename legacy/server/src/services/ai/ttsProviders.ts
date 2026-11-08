import { TTSProvider, TTSOptions, TTSVoice, VoiceCloningOptions, ClonedVoiceResult } from './providerInterfaces.js';
import { config } from '../../config/env.js';

export class ElevenLabsProvider implements TTSProvider {
  name = 'elevenlabs';
  private baseUrl = 'https://api.elevenlabs.io/v1';

  isConfigured(): boolean {
    return !!config.ai.elevenlabsApiKey;
  }

  async getVoices(): Promise<TTSVoice[]> {
    if (!this.isConfigured()) return [];

    const res = await fetch(`${this.baseUrl}/voices`, {
      headers: { 'xi-api-key': config.ai.elevenlabsApiKey! },
    });

    if (!res.ok) return [];

    const data = (await res.json()) as any;
    return data.voices?.map((v: any) => ({
      id: v.voice_id,
      name: v.name,
      language: v.labels?.language || 'en',
      gender: v.labels?.gender,
      previewUrl: v.preview_url,
      provider: 'elevenlabs',
    })) || [];
  }

  async synthesize(text: string, options: TTSOptions): Promise<Buffer> {
    if (!this.isConfigured()) {
      throw new Error('ElevenLabs API key not configured');
    }

    const voiceId = options.voiceId || '21m00Tcm4TlvDq8ikWAM';
    const modelId = options.modelId || 'eleven_monolingual_v1';

    const res = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': config.ai.elevenlabsApiKey!,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`ElevenLabs TTS failed: ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async cloneVoice(options: VoiceCloningOptions): Promise<ClonedVoiceResult> {
    if (!this.isConfigured()) {
      throw new Error('ElevenLabs API key not configured');
    }

    const formData = new FormData();
    formData.append('name', options.name);
    if (options.description) formData.append('description', options.description);
    if (options.labels) formData.append('labels', JSON.stringify(options.labels));

    // Add audio files
    options.audioFiles.forEach((buffer, idx) => {
      const blob = new Blob([buffer], { type: 'audio/mpeg' });
      formData.append('files', blob, `sample_${idx}.mp3`);
    });

    const res = await fetch(`${this.baseUrl}/voices/add`, {
      method: 'POST',
      headers: { 'xi-api-key': config.ai.elevenlabsApiKey! },
      body: formData,
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`ElevenLabs voice cloning failed: ${res.status} - ${error}`);
    }

    const data = (await res.json()) as any;
    return {
      voiceId: data.voice_id,
      name: options.name,
      status: 'ready',
      previewUrl: data.preview_url,
      createdAt: new Date(),
    };
  }

  async deleteVoice(voiceId: string): Promise<void> {
    if (!this.isConfigured()) return;

    await fetch(`${this.baseUrl}/voices/${voiceId}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': config.ai.elevenlabsApiKey! },
    });
  }

  async getVoice(voiceId: string): Promise<TTSVoice | null> {
    if (!this.isConfigured()) return null;

    const res = await fetch(`${this.baseUrl}/voices/${voiceId}`, {
      headers: { 'xi-api-key': config.ai.elevenlabsApiKey! },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as any;
    return {
      id: data.voice_id,
      name: data.name,
      language: data.labels?.language || 'en',
      gender: data.labels?.gender,
      previewUrl: data.preview_url,
      provider: 'elevenlabs',
      isCustom: true,
      createdAt: new Date(),
    };
  }
}

export class OpenAITTSProvider implements TTSProvider {
  name = 'openai-tts';
  private baseUrl = 'https://api.openai.com/v1';

  isConfigured(): boolean {
    return !!config.ai.openaiApiKey;
  }

  async getVoices(): Promise<TTSVoice[]> {
    return [
      { id: 'alloy', name: 'Alloy', language: 'en', gender: 'neutral', provider: 'openai' },
      { id: 'echo', name: 'Echo', language: 'en', gender: 'male', provider: 'openai' },
      { id: 'fable', name: 'Fable', language: 'en', gender: 'neutral', provider: 'openai' },
      { id: 'onyx', name: 'Onyx', language: 'en', gender: 'male', provider: 'openai' },
      { id: 'nova', name: 'Nova', language: 'en', gender: 'female', provider: 'openai' },
      { id: 'shimmer', name: 'Shimmer', language: 'en', gender: 'female', provider: 'openai' },
    ];
  }

  async synthesize(text: string, options: TTSOptions): Promise<Buffer> {
    if (!this.isConfigured()) {
      throw new Error('OpenAI API key not configured');
    }

    const voice = options.voiceId || 'nova';
    const model = options.modelId || 'tts-1-hd';
    const format = options.outputFormat || 'mp3';

    const res = await fetch(`${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.ai.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        response_format: format,
        speed: options.speed || 1.0,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI TTS failed: ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Voice cloning not supported by OpenAI TTS
  async cloneVoice(_options: VoiceCloningOptions): Promise<ClonedVoiceResult> {
    throw new Error('Voice cloning not supported by OpenAI TTS');
  }

  async deleteVoice(_voiceId: string): Promise<void> {
    // No-op for OpenAI
  }

  async getVoice(_voiceId: string): Promise<TTSVoice | null> {
    return null;
  }
}

export function getTTSProvider(preferred?: 'elevenlabs' | 'openai'): TTSProvider {
  if (preferred === 'elevenlabs' || (!preferred && config.ai.elevenlabsApiKey)) {
    return new ElevenLabsProvider();
  }
  return new OpenAITTSProvider();
}