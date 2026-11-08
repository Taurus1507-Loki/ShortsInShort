import { config } from '../../config/env.js';

export interface BrollItem {
  id: string;
  query: string;
  videoUrl: string;
  previewImageUrl: string;
  duration: number;
  author: string;
}

const CURATED_STOCK_MEDIA: Record<string, BrollItem> = {
  'smartphone': {
    id: 'stock-phone-1',
    query: 'person using smartphone',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-young-woman-scrolling-on-her-smartphone-40822-large.mp4',
    previewImageUrl: 'https://images.unsplash.com/photo-1512499617640-c74ae3a79d37?w=400&auto=format&fit=crop&q=80',
    duration: 12,
    author: 'Mixkit / Royalty-Free',
  },
  'growth': {
    id: 'stock-growth-1',
    query: 'financial growth chart',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-stock-market-candlesticks-rising-43098-large.mp4',
    previewImageUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&auto=format&fit=crop&q=80',
    duration: 15,
    author: 'Mixkit / Royalty-Free',
  },
  'technology': {
    id: 'stock-tech-1',
    query: 'technology workflow',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-hands-typing-on-a-laptop-keyboard-41133-large.mp4',
    previewImageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=400&auto=format&fit=crop&q=80',
    duration: 10,
    author: 'Mixkit / Royalty-Free',
  },
  'ai': {
    id: 'stock-ai-1',
    query: 'futuristic technology code',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-abstract-flowing-data-particles-42823-large.mp4',
    previewImageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80',
    duration: 14,
    author: 'Mixkit / Royalty-Free',
  },
  'meeting': {
    id: 'stock-meeting-1',
    query: 'creative business brainstorm',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-colleagues-discussing-work-in-an-office-42618-large.mp4',
    previewImageUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=400&auto=format&fit=crop&q=80',
    duration: 11,
    author: 'Mixkit / Royalty-Free',
  },
};

export class BrollService {
  /**
   * Finds relevant stock B-roll video for a given semantic search query
   */
  public static async searchBroll(query: string, orientation: 'portrait' | 'landscape' = 'portrait'): Promise<BrollItem> {
    // 1. Try Pexels Video API if key exists
    if (config.ai.pexelsApiKey) {
      try {
        const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=1`;
        const res = await fetch(url, {
          headers: { Authorization: config.ai.pexelsApiKey },
        });

        if (res.ok) {
          const data = (await res.json()) as any;
          const video = data.videos?.[0];
          if (video) {
            // Find appropriate resolution file
            const file = video.video_files?.find((f: any) => f.quality === 'hd') || video.video_files?.[0];
            return {
              id: `pexels-${video.id}`,
              query,
              videoUrl: file?.link || CURATED_STOCK_MEDIA.technology.videoUrl,
              previewImageUrl: video.image,
              duration: video.duration || 10,
              author: video.user?.name || 'Pexels Creator',
            };
          }
        }
      } catch (err: any) {
        console.warn('⚠️ Pexels API search deferred, falling back to curated library:', err.message);
      }
    }

    // 2. Fallback to categorized curated royalty-free clips
    const lower = query.toLowerCase();
    if (lower.includes('phone') || lower.includes('instagram') || lower.includes('reels')) {
      return CURATED_STOCK_MEDIA.smartphone;
    }
    if (lower.includes('grow') || lower.includes('money') || lower.includes('chart') || lower.includes('finance')) {
      return CURATED_STOCK_MEDIA.growth;
    }
    if (lower.includes('ai') || lower.includes('future') || lower.includes('code')) {
      return CURATED_STOCK_MEDIA.ai;
    }
    if (lower.includes('office') || lower.includes('team') || lower.includes('business')) {
      return CURATED_STOCK_MEDIA.meeting;
    }

    return CURATED_STOCK_MEDIA.technology;
  }
}
