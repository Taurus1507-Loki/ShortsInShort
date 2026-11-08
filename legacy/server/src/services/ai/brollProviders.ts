import { BrollProvider, BrollSearchOptions, BrollResult } from './providerInterfaces.js';
import { config } from '../../config/env.js';

const CURATED_STOCK: BrollResult[] = [
  {
    id: 'stock-phone-1',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-young-woman-scrolling-on-her-smartphone-40822-large.mp4',
    previewUrl: 'https://images.unsplash.com/photo-1512499617640-c74ae3a79d37?w=400&auto=format&fit=crop&q=80',
    duration: 12,
    author: 'Mixkit / Royalty-Free',
    license: 'royalty-free',
    tags: ['smartphone', 'mobile', 'social media', 'scrolling'],
  },
  {
    id: 'stock-growth-1',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-stock-market-candlesticks-rising-43098-large.mp4',
    previewUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&auto=format&fit=crop&q=80',
    duration: 15,
    author: 'Mixkit / Royalty-Free',
    license: 'royalty-free',
    tags: ['finance', 'growth', 'chart', 'money', 'business'],
  },
  {
    id: 'stock-tech-1',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-hands-typing-on-a-laptop-keyboard-41133-large.mp4',
    previewUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=400&auto=format&fit=crop&q=80',
    duration: 10,
    author: 'Mixkit / Royalty-Free',
    license: 'royalty-free',
    tags: ['technology', 'coding', 'work', 'laptop', 'developer'],
  },
  {
    id: 'stock-ai-1',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-abstract-flowing-data-particles-42823-large.mp4',
    previewUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80',
    duration: 14,
    author: 'Mixkit / Royalty-Free',
    license: 'royalty-free',
    tags: ['ai', 'artificial intelligence', 'data', 'futuristic', 'technology'],
  },
  {
    id: 'stock-meeting-1',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-colleagues-discussing-work-in-an-office-42618-large.mp4',
    previewUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=400&auto=format&fit=crop&q=80',
    duration: 11,
    author: 'Mixkit / Royalty-Free',
    license: 'royalty-free',
    tags: ['meeting', 'business', 'team', 'office', 'collaboration'],
  },
  {
    id: 'stock-creator-1',
    videoUrl: 'https://assets.mixkit.co/videos/preview/mixkit-young-man-recording-video-with-phone-40819-large.mp4',
    previewUrl: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&auto=format&fit=crop&q=80',
    duration: 13,
    author: 'Mixkit / Royalty-Free',
    license: 'royalty-free',
    tags: ['content creator', 'recording', 'video', 'phone', 'influencer'],
  },
];

export class PexelsProvider implements BrollProvider {
  name = 'pexels';

  isConfigured(): boolean {
    return !!config.ai.pexelsApiKey;
  }

  async search(query: string, options: BrollSearchOptions): Promise<BrollResult[]> {
    if (!this.isConfigured()) return [];

    const orientationMap = { portrait: 'portrait', landscape: 'landscape', square: 'square' };
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientationMap[options.orientation]}&per_page=${options.count || 5}`;

    const res = await fetch(url, { headers: { Authorization: config.ai.pexelsApiKey! } });

    if (!res.ok) return [];

    const data = (await res.json()) as any;
    return data.videos?.map((v: any) => {
      const file = v.video_files?.find((f: any) => f.quality === 'hd') || v.video_files?.[0];
      return {
        id: `pexels-${v.id}`,
        videoUrl: file?.link || '',
        previewUrl: v.image,
        duration: v.duration || 10,
        author: v.user?.name || 'Pexels Creator',
        license: 'royalty-free',
        tags: [query, ...(v.tags || [])],
      };
    }) || [];
  }
}

export class PixabayProvider implements BrollProvider {
  name = 'pixabay';

  isConfigured(): boolean {
    return !!config.ai.pixabayApiKey;
  }

  async search(query: string, options: BrollSearchOptions): Promise<BrollResult[]> {
    if (!this.isConfigured()) return [];

    try {
      const url = `https://pixabay.com/api/videos/?key=${config.ai.pixabayApiKey}&q=${encodeURIComponent(query)}&per_page=${options.count || 5}&safesearch=true`;
      const res = await fetch(url);
      if (!res.ok) return [];

      const data = (await res.json()) as any;
      return (data.hits || []).map((hit: any) => {
        const videoFile = hit.videos?.medium?.url || hit.videos?.small?.url || hit.videos?.large?.url || '';
        const previewUrl = hit.picture_id 
          ? `https://i.vimeocdn.com/video/${hit.picture_id}_640x360.jpg`
          : 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=400';

        return {
          id: `pixabay-${hit.id}`,
          videoUrl: videoFile,
          previewUrl,
          duration: hit.duration || 10,
          author: hit.user || 'Pixabay Creator',
          license: 'royalty-free',
          tags: [query, ...(hit.tags ? hit.tags.split(',').map((t: string) => t.trim()) : [])],
        };
      });
    } catch {
      return [];
    }
  }
}

export class CuratedStockProvider implements BrollProvider {
  name = 'curated-stock';

  isConfigured(): boolean {
    return true;
  }

  async search(query: string, options: BrollSearchOptions): Promise<BrollResult[]> {
    const lower = query.toLowerCase();
    let filtered = CURATED_STOCK;

    if (lower.includes('phone') || lower.includes('mobile') || lower.includes('instagram') || lower.includes('reels')) {
      filtered = CURATED_STOCK.filter(s => s.tags.some(t => ['smartphone', 'mobile', 'social media'].includes(t)));
    } else if (lower.includes('growth') || lower.includes('money') || lower.includes('finance') || lower.includes('business')) {
      filtered = CURATED_STOCK.filter(s => s.tags.some(t => ['finance', 'growth', 'business', 'money'].includes(t)));
    } else if (lower.includes('ai') || lower.includes('artificial') || lower.includes('future') || lower.includes('tech')) {
      filtered = CURATED_STOCK.filter(s => s.tags.some(t => ['ai', 'technology', 'futuristic', 'data'].includes(t)));
    } else if (lower.includes('meeting') || lower.includes('team') || lower.includes('office') || lower.includes('work')) {
      filtered = CURATED_STOCK.filter(s => s.tags.some(t => ['meeting', 'team', 'office', 'collaboration'].includes(t)));
    } else if (lower.includes('creator') || lower.includes('record') || lower.includes('video')) {
      filtered = CURATED_STOCK.filter(s => s.tags.some(t => ['content creator', 'recording', 'video'].includes(t)));
    }

    return filtered.slice(0, options.count || 3);
  }
}

export function getBrollProvider(preferred?: 'pexels' | 'pixabay' | 'curated'): BrollProvider {
  if (preferred === 'pexels' || (!preferred && config.ai.pexelsApiKey)) {
    return new PexelsProvider();
  }
  if (preferred === 'pixabay' || (!preferred && config.ai.pixabayApiKey)) {
    return new PixabayProvider();
  }
  return new CuratedStockProvider();
}