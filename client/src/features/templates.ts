import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MotionScene } from '@/motion/types';
import type { AspectRatio, EditingStyle, ProjectMode, ProjectSettings } from '@/types/api';

export type TemplateNiche = 'creators' | 'tech' | 'doctors' | 'coaches' | 'finance' | 'real_estate' | 'business' | 'educators' | 'food' | 'storytellers';
export const NICHE_LABEL: Record<TemplateNiche, string> = {
  creators: 'Creators',
  tech: 'Tech & AI',
  doctors: 'Doctors',
  coaches: 'Coaches',
  finance: 'Finance & CAs',
  real_estate: 'Real estate',
  business: 'Businesses',
  educators: 'Educators',
  food: 'Food',
  storytellers: 'Storytellers',
};

/** A ready-made starting point for a project (served by GET /api/templates). */
export interface VideoTemplate {
  id: string;
  name: string;
  category: 'marketing' | 'education' | 'social' | 'business' | 'lifestyle';
  description: string;
  mode: ProjectMode;
  aspectRatio: AspectRatio;
  style: EditingStyle;
  settings: Partial<ProjectSettings>;
  title: string;
  topic: string;
  script: string;
  bestFor: string;
  niches: TemplateNiche[];
  motionScenes?: MotionScene[];
  preview: 'motion' | 'stock' | 'none';
  favorite: boolean;
}

export const useTemplates = (enabled = true) =>
  useQuery({ queryKey: ['templates'], queryFn: () => api<{ data: VideoTemplate[] }>('/templates').then((r) => r.data), staleTime: 5 * 60_000, enabled });
