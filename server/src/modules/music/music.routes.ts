import { Router } from 'express';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, forbidden, notFound } from '../../utils/errors.js';
import { safeEqual } from '../../utils/crypto.js';
import { loadLibrary } from '../../services/ai/music.js';
import { readManifest, trackPath } from '../../services/ai/musicLibrary.js';

/**
 * Background-music library for creators: the tracks they can pick on the editor's music track, each
 * with a short-lived signed preview link (so the browser's audio player can play it without
 * sending the login token).
 */
export const musicRouter = Router();

const PREVIEW_TTL_SEC = 3600;
const sign = (file: string, exp: number) => createHmac('sha256', env.storage.signingSecret).update(`music|${file}|${exp}`).digest('hex');

musicRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const usable = new Set(loadLibrary().map((t) => t.file));
    const exp = Math.floor(Date.now() / 1000) + PREVIEW_TTL_SEC;
    const tracks = (await readManifest())
      .filter((t) => usable.has(t.file))
      .map((t) => ({ file: t.file, title: t.title, artist: t.artist, moods: t.moods, durationSec: t.durationSec ?? null, license: t.license, previewUrl: `/api/music/audio/${t.file}?exp=${exp}&sig=${sign(t.file, exp)}` }));
    res.json({ data: { tracks } });
  }),
);

musicRouter.get(
  '/audio/:file',
  validate({ params: z.object({ file: z.string().regex(/^[a-z0-9-]+\.mp3$/) }) }),
  asyncHandler(async (req, res) => {
    const file = req.params.file!;
    const exp = Number(req.query.exp);
    const sig = String(req.query.sig ?? '');
    if (!Number.isFinite(exp) || exp < Date.now() / 1000 || !safeEqual(sig, sign(file, exp))) throw forbidden('This music link has expired. Reload the page.');
    const full = trackPath(file);
    if (!full) throw notFound('Track not found.');
    res.set('Cache-Control', 'private, max-age=3600').type('audio/mpeg').sendFile(full);
  }),
);
