import { AvatarProvider, CreateAvatarOptions, AvatarResult, AvatarGenerationOptions, AvatarVideoResult } from './providerInterfaces.js';
import { config } from '../../config/env.js';

export class HeyGenProvider implements AvatarProvider {
  name = 'heygen';
  private baseUrl = 'https://api.heygen.com/v2';

  isConfigured(): boolean {
    return !!config.ai.heygenApiKey;
  }

  async createAvatar(options: CreateAvatarOptions): Promise<AvatarResult> {
    if (!this.isConfigured()) {
      throw new Error('HeyGen API key not configured');
    }

    const formData = new FormData();
    formData.append('name', options.name);
    formData.append('avatar_type', 'instant');
    formData.append('image_file', new Blob([options.imageFile]), 'avatar.jpg');

    if (options.voiceFile) {
      formData.append('voice_file', new Blob([options.voiceFile]), 'voice.mp3');
    }

    const res = await fetch(`${this.baseUrl}/avatars`, {
      method: 'POST',
      headers: { 'X-Api-Key': config.ai.heygenApiKey! },
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`HeyGen avatar creation failed: ${res.status}`);
    }

    const data = (await res.json()) as any;
    return {
      id: data.data.avatar_id,
      name: options.name,
      status: 'processing',
      createdAt: new Date(),
    };
  }

  async getAvatar(avatarId: string): Promise<AvatarResult | null> {
    if (!this.isConfigured()) return null;

    const res = await fetch(`${this.baseUrl}/avatars/${avatarId}`, {
      headers: { 'X-Api-Key': config.ai.heygenApiKey! },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as any;
    return {
      id: data.data.avatar_id,
      name: data.data.avatar_name,
      previewImageUrl: data.data.preview_image_url,
      status: data.data.status,
      createdAt: new Date(data.data.created_at),
    };
  }

  async deleteAvatar(avatarId: string): Promise<void> {
    if (!this.isConfigured()) return;

    await fetch(`${this.baseUrl}/avatars/${avatarId}`, {
      method: 'DELETE',
      headers: { 'X-Api-Key': config.ai.heygenApiKey! },
    });
  }

  async generateVideo(options: AvatarGenerationOptions): Promise<AvatarVideoResult> {
    if (!this.isConfigured()) {
      throw new Error('HeyGen API key not configured');
    }

    const res = await fetch(`${this.baseUrl}/video/generate`, {
      method: 'POST',
      headers: {
        'X-Api-Key': config.ai.heygenApiKey!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        avatar_id: options.avatarId,
        script: options.script,
        voice_id: options.voiceId,
        language: options.language || 'en',
        aspect_ratio: options.aspectRatio === '9:16' ? '9:16' : '16:9',
        resolution: options.resolution,
        background_url: options.backgroundUrl,
      }),
    });

    if (!res.ok) {
      throw new Error(`HeyGen video generation failed: ${res.status}`);
    }

    const data = (await res.json()) as any;
    return {
      videoUrl: data.data.video_url,
      duration: data.data.duration,
      thumbnailUrl: data.data.thumbnail_url,
    };
  }
}

export class MockAvatarProvider implements AvatarProvider {
  name = 'mock-avatar';

  isConfigured(): boolean {
    return true;
  }

  async createAvatar(options: CreateAvatarOptions): Promise<AvatarResult> {
    return {
      id: `mock-${Date.now()}`,
      name: options.name,
      status: 'ready',
      createdAt: new Date(),
    };
  }

  async getAvatar(avatarId: string): Promise<AvatarResult | null> {
    return {
      id: avatarId,
      name: 'Mock Avatar',
      status: 'ready',
      createdAt: new Date(),
    };
  }

  async deleteAvatar(_avatarId: string): Promise<void> {}

  async generateVideo(options: AvatarGenerationOptions): Promise<AvatarVideoResult> {
    return {
      videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-young-woman-scrolling-on-her-smartphone-40822-large.mp4',
      duration: 30,
      thumbnailUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=400',
    };
  }
}

export function getAvatarProvider(preferred?: 'heygen' | 'mock'): AvatarProvider {
  if (preferred === 'heygen' || (!preferred && config.ai.heygenApiKey)) {
    return new HeyGenProvider();
  }
  return new MockAvatarProvider();
}