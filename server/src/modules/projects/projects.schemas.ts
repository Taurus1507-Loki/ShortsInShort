import { z } from 'zod';
import { Types } from 'mongoose';
import {
  ASPECT_RATIOS,
  CAPTION_POSITIONS,
  CAPTION_SIZES,
  FRAMINGS,
  EDITING_STYLES,
  INTENSITIES,
  PROJECT_MODES,
  PROJECT_STATUSES,
  RESOLUTIONS,
} from '../../models/Project.js';

export const SUPPORTED_LANGUAGES = ['en', 'hi', 'te', 'ta', 'mr'] as const;

const settingsSchema = z
  .object({
    captionsEnabled: z.boolean(),
    captionStyle: z.enum(['bold_pop', 'clean_minimal', 'karaoke', 'boxed', 'cinematic']),
    captionPosition: z.enum(CAPTION_POSITIONS),
    captionSize: z.enum(CAPTION_SIZES),
    captionLanguage: z.enum(['same', ...SUPPORTED_LANGUAGES]),
    highlightColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #A78BFA'),
    musicMood: z.enum(['auto', 'none', 'upbeat', 'calm', 'cinematic', 'corporate', 'lofi']),
    bRollIntensity: z.enum(INTENSITIES),
    editingIntensity: z.enum(INTENSITIES),
    language: z.enum(SUPPORTED_LANGUAGES),
    framing: z.enum(FRAMINGS),
    targetDurationSec: z.number().int().min(5).max(3600),
    resolution: z.enum(RESOLUTIONS),
  })
  .strict()
  .partial();

export const createProjectSchema = z
  .object({
    title: z.string().trim().min(1, 'Give your project a title.').max(120),
    mode: z.enum(PROJECT_MODES),
    aspectRatio: z.enum(ASPECT_RATIOS).default('9:16'),
    style: z.enum(EDITING_STYLES).default('viral'),
    script: z.string().max(20000).default(''),
    topic: z.string().trim().max(300).default(''),
    settings: settingsSchema.default({}),
    sourceAssetId: z
      .string()
      .refine((v) => Types.ObjectId.isValid(v), 'Invalid asset id')
      .nullable()
      .optional(),
  })
  .strict();

export const updateProjectSchema = createProjectSchema.omit({ mode: true }).partial().strict();

export const listProjectsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  status: z.enum(PROJECT_STATUSES).optional(),
  mode: z.enum(PROJECT_MODES).optional(),
  q: z.string().trim().max(100).optional(),
});

export const idParams = z.object({ id: z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid project id') });
