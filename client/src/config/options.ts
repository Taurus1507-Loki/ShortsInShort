import { Clapperboard, UserRound, Wand2, type LucideIcon } from 'lucide-react';
import type { AspectRatio, EditingStyle, ProjectMode, ProjectSettings, ProjectStatus } from '@/types/api';

/** Option lists mirror the server's enums (server/src/models/Project.ts). */

export const MODES: { id: ProjectMode; name: string; description: string; icon: LucideIcon; phase: number }[] = [
  {
    id: 'editor',
    name: 'AI Video Editor',
    description: 'Upload raw footage. AI trims silences, adds captions, B-roll, music and zooms.',
    icon: Wand2,
    phase: 2,
  },
  {
    id: 'avatar',
    name: 'AI Avatar Video',
    description: 'Your consented digital avatar and voice present your script.',
    icon: UserRound,
    phase: 3,
  },
  {
    id: 'faceless',
    name: 'Faceless Video',
    description: 'Turn a topic or script into narrated scenes with licensed visuals.',
    icon: Clapperboard,
    phase: 4,
  },
];

export const STYLES: { id: EditingStyle; name: string; blurb: string }[] = [
  { id: 'viral', name: 'Viral', blurb: 'Fast cuts, punchy captions, energetic zooms' },
  { id: 'podcast', name: 'Podcast', blurb: 'Clean captions, calm pacing, speaker focus' },
  { id: 'cinematic', name: 'Cinematic', blurb: 'Graded look, letterbox titles, slow moves' },
  { id: 'educational', name: 'Educational', blurb: 'Keyword highlights, diagrams-friendly layout' },
  { id: 'business', name: 'Business', blurb: 'Confident type, brand colours, crisp B-roll' },
  { id: 'storytelling', name: 'Storytelling', blurb: 'Narrative pacing with mood-led music' },
  { id: 'vlog', name: 'Vlog', blurb: 'Casual, playful captions and jump cuts' },
  { id: 'product_promotion', name: 'Product Promo', blurb: 'Hook-first, benefit callouts, strong CTA' },
];

export const ASPECTS: { id: AspectRatio; name: string; platforms: string }[] = [
  { id: '9:16', name: 'Vertical 9:16', platforms: 'Reels · Shorts · TikTok' },
  { id: '16:9', name: 'Landscape 16:9', platforms: 'YouTube' },
  { id: '1:1', name: 'Square 1:1', platforms: 'Instagram feed' },
  { id: '4:5', name: 'Portrait 4:5', platforms: 'Instagram feed' },
];

export const LANGUAGES: { id: ProjectSettings['language']; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'hi', name: 'Hindi · हिन्दी' },
  { id: 'te', name: 'Telugu · తెలుగు' },
  { id: 'ta', name: 'Tamil · தமிழ்' },
  { id: 'mr', name: 'Marathi · मराठी' },
];

export const CAPTION_STYLES: { id: ProjectSettings['captionStyle']; name: string }[] = [
  { id: 'bold_pop', name: 'Bold pop' },
  { id: 'clean_minimal', name: 'Clean minimal' },
  { id: 'karaoke', name: 'Karaoke highlight' },
  { id: 'boxed', name: 'Boxed' },
  { id: 'cinematic', name: 'Cinematic' },
];

export const MUSIC_MOODS: { id: ProjectSettings['musicMood']; name: string }[] = [
  { id: 'auto', name: 'Match the style' },
  { id: 'none', name: 'No music' },
  { id: 'upbeat', name: 'Upbeat' },
  { id: 'calm', name: 'Calm' },
  { id: 'cinematic', name: 'Cinematic' },
  { id: 'corporate', name: 'Corporate' },
  { id: 'lofi', name: 'Lo-fi' },
];

export const STATUS_META: Record<ProjectStatus, { label: string; variant: 'muted' | 'accent' | 'warning' | 'success' | 'destructive' }> = {
  draft: { label: 'Draft', variant: 'muted' },
  queued: { label: 'Queued', variant: 'accent' },
  processing: { label: 'Processing', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
};

export const modeName = (m: ProjectMode) => MODES.find((x) => x.id === m)?.name ?? m;
export const styleName = (s: EditingStyle) => STYLES.find((x) => x.id === s)?.name ?? s;
