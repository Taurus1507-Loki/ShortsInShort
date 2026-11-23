import { Router } from 'express';
import { PhotoAvatar } from '../../models/PhotoAvatar.js';
import { ownPhotoAvatar } from '../../services/voice/consent.js';
import { CREDIT_COSTS } from '../../config/credits.js';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { aiWriteLimiter } from '../../middleware/security.js';
import { AppError, asyncHandler } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';
import { EDITING_STYLES } from '../../models/Project.js';
import { getLLMProvider, LLMError } from '../../services/ai/llm.js';
import { writeScript } from '../../services/ai/script.js';
import { AvatarError, getAvatarProvider, listAvatarsCached } from '../../services/ai/avatar.js';
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

/** Stock talking presenters from the avatar provider (cached). */
aiRouter.get(
  '/avatars',
  asyncHandler(async (req, res) => {
    const provider = getAvatarProvider();
    if (!provider) throw new AppError(503, 'NOT_CONFIGURED', 'Talking presenters are not configured on this server.');
    try {
      const mine = await PhotoAvatar.find({ workspaceId: req.auth!.workspaceId, status: 'ready', deletedAt: null }).sort({ createdAt: -1 });
      const own = [];
      for (const a of mine) if (await ownPhotoAvatar(req.auth!.workspaceId, a.providerLookId!)) own.push(a);
      const stock = (await listAvatarsCached()).map((a) => ({ ...a, own: false }));
      const photos = own.map((a) => ({ id: a.providerLookId!, name: a.name, gender: null, previewImageUrl: a.previewImageUrl, previewVideoUrl: null, orientation: null, tags: ['your avatar'], own: true }));
      res.json({ data: [...photos, ...stock], meta: { provider: provider.name, prices: { stockPer30s: CREDIT_COSTS.presenterPer30s, ownPer30s: CREDIT_COSTS.photoPresenterPer30s } } });
    } catch (err) {
      logger.warn({ err }, 'Avatar list failed');
      throw new AppError(502, 'PROVIDER_ERROR', err instanceof AvatarError ? err.message : 'Could not load presenters. Try again shortly.');
    }
  }),
);
