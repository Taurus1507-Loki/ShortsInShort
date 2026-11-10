import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { aiWriteLimiter } from '../../middleware/security.js';
import { AppError, asyncHandler } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';
import { EDITING_STYLES } from '../../models/Project.js';
import { getLLMProvider, LLMError } from '../../services/ai/llm.js';
import { writeScript } from '../../services/ai/script.js';
import { SUPPORTED_LANGUAGES } from '../projects/projects.schemas.js';

export const aiRouter = Router();
aiRouter.use(requireAuth);

/** Drafts a voiceover script from a topic. Free (no credits) but rate-limited per user. */
aiRouter.post(
  '/script',
  requireVerifiedEmail,
  aiWriteLimiter,
  validate({
    body: z
      .object({
        topic: z.string().trim().min(3, 'Describe the topic in a few words.').max(300),
        language: z.enum(SUPPORTED_LANGUAGES).default('en'),
        durationSec: z.number().int().min(15).max(180).default(45),
        style: z.enum(EDITING_STYLES).default('viral'),
        notes: z.string().trim().max(500).optional(),
      })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    const llm = getLLMProvider();
    if (!llm) throw new AppError(503, 'NOT_CONFIGURED', 'AI script writing is not configured on this server.');
    try {
      res.json({ data: await writeScript(llm, req.body) });
    } catch (err) {
      logger.warn({ err }, 'Script writing failed');
      throw new AppError(502, 'PROVIDER_ERROR', err instanceof LLMError ? err.message : 'The AI couldn’t write a script right now. Try again.');
    }
  }),
);
