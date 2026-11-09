import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler, AppError, notConfigured } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';
import { getTtsProvider, listVoicesCached, TtsError } from '../../services/ai/tts.js';

export const voicesRouter = Router();
voicesRouter.use(requireAuth);

/** Voices available for voiceovers (provider library + account voices), cached server-side. */
voicesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const provider = getTtsProvider();
    if (!provider) throw notConfigured('AI voices');
    try {
      const voices = await listVoicesCached();
      res.json({ data: voices, meta: { provider: provider.name } });
    } catch (err) {
      logger.warn({ err }, 'Voice list failed');
      throw new AppError(502, 'PROVIDER_ERROR', err instanceof TtsError ? err.message : 'Could not load voices from the provider. Try again shortly.');
    }
  }),
);
