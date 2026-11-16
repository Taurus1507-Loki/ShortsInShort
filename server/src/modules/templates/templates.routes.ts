import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, notFound } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';
import { User } from '../../models/User.js';
import { VIDEO_TEMPLATES, templateById, type VideoTemplate } from '../../config/templates.js';
import { getStockProvider, rankClips } from '../../services/ai/stock.js';

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

const idParams = z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/) });

/** Card data for the gallery (the full template is returned too: the wizard pre-fills from it). */
const toPublic = (t: VideoTemplate, favorites: string[]) => ({ ...t, favorite: favorites.includes(t.id), preview: t.motionScenes ? 'motion' : t.previewQuery ? 'stock' : 'none' });

templatesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.auth!.user._id).select('favoriteTemplates').lean();
    const favorites = user?.favoriteTemplates ?? [];
    res.json({ data: VIDEO_TEMPLATES.map((t) => toPublic(t, favorites)) });
  }),
);

templatesRouter.put(
  '/:id/favorite',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    if (!templateById(req.params.id!)) throw notFound('Template not found.');
    await User.updateOne({ _id: req.auth!.user._id }, { $addToSet: { favoriteTemplates: req.params.id } });
    res.json({ data: { favorite: true } });
  }),
);

templatesRouter.delete(
  '/:id/favorite',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    await User.updateOne({ _id: req.auth!.user._id }, { $pull: { favoriteTemplates: req.params.id } });
    res.json({ data: { favorite: false } });
  }),
);

/**
 * Preview stills for a stock or editor template: thumbnails of real licensed clips matching its
 * search, cached for 6 hours so browsing the gallery costs one search per template, not per view.
 * Only provider thumbnails are returned — video files are never hotlinked.
 */
const previewCache = new Map<string, { at: number; thumbnails: string[] }>();
const PREVIEW_TTL_MS = 6 * 3600_000;

templatesRouter.get(
  '/:id/preview',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const t = templateById(req.params.id!);
    if (!t) throw notFound('Template not found.');
    const stock = getStockProvider();
    if (!t.previewQuery || !stock) return res.json({ data: { thumbnails: [] } });
    const hit = previewCache.get(t.id);
    if (hit && Date.now() - hit.at < PREVIEW_TTL_MS) return res.json({ data: { thumbnails: hit.thumbnails } });
    try {
      const clips = await stock.searchVideos(t.previewQuery, { perPage: 8, signal: AbortSignal.timeout(10_000) });
      const thumbnails = rankClips(clips, t.previewQuery)
        .map((c) => c.thumbnailUrl)
        .filter((u): u is string => typeof u === 'string' && u.startsWith('https://'))
        .slice(0, 3);
      previewCache.set(t.id, { at: Date.now(), thumbnails });
      res.json({ data: { thumbnails } });
    } catch (err) {
      logger.warn({ err, template: t.id }, 'Template preview search failed');
      res.json({ data: { thumbnails: [] } });
    }
  }),
);
