import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, badRequest } from '../../utils/errors.js';
import { BrandKit, CAPTION_STYLE_IDS, LOGO_POSITIONS, LOGO_SIZES, type BrandKitDoc } from '../../models/BrandKit.js';
import { CAPTION_POSITIONS, CAPTION_SIZES } from '../../models/Project.js';
import { Asset, toPublicAsset } from '../../models/Asset.js';
import { audit } from '../../services/audit.service.js';

export const brandKitRouter = Router();
brandKitRouter.use(requireAuth);

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #7C3AED');

const updateSchema = z
  .object({
    logoAssetId: z
      .string()
      .refine((v) => Types.ObjectId.isValid(v), 'Invalid asset id')
      .nullable(),
    logoPosition: z.enum(LOGO_POSITIONS),
    logoSize: z.enum(LOGO_SIZES),
    logoOpacity: z.number().min(0.2).max(1),
    primaryColor: hex,
    secondaryColor: hex,
    captionStyle: z.enum(CAPTION_STYLE_IDS),
    captionPosition: z.enum(CAPTION_POSITIONS),
    captionSize: z.enum(CAPTION_SIZES),
    highlightColor: hex,
    applyToNewProjects: z.boolean(),
  })
  .strict()
  .partial();

async function toPublic(kit: BrandKitDoc) {
  const logo = kit.logoAssetId ? await Asset.findOne({ _id: kit.logoAssetId, workspaceId: kit.workspaceId, deletedAt: null, status: 'ready' }) : null;
  return {
    logo: logo ? toPublicAsset(logo) : null,
    logoPosition: kit.logoPosition,
    logoSize: kit.logoSize,
    logoOpacity: kit.logoOpacity,
    primaryColor: kit.primaryColor,
    secondaryColor: kit.secondaryColor,
    captionStyle: kit.captionStyle,
    captionPosition: kit.captionPosition,
    captionSize: kit.captionSize,
    highlightColor: kit.highlightColor,
    applyToNewProjects: kit.applyToNewProjects,
    updatedAt: kit.get('updatedAt') as Date,
  };
}

/** Returns the workspace's kit, creating it with defaults on first access. */
export async function getOrCreateKit(workspaceId: Types.ObjectId) {
  return BrandKit.findOneAndUpdate({ workspaceId }, { $setOnInsert: { workspaceId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

brandKitRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ data: await toPublic(await getOrCreateKit(req.auth!.workspaceId)) });
  }),
);

brandKitRouter.put(
  '/',
  validate({ body: updateSchema }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const body = req.body as z.infer<typeof updateSchema>;
    if (body.logoAssetId) {
      const ok = await Asset.exists({ _id: body.logoAssetId, workspaceId, deletedAt: null, status: 'ready', kind: 'brand_logo' });
      if (!ok) throw badRequest('That logo is not available. Upload it again.', 'INVALID_ASSET');
    }
    const kit = await getOrCreateKit(workspaceId);
    kit.set(body);
    await kit.save();
    await audit(req, 'brandkit.updated', { actorId: user._id, workspaceId, metadata: { fields: Object.keys(body) } });
    res.json({ data: await toPublic(kit) });
  }),
);
