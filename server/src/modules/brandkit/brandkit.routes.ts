import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AppError, asyncHandler, badRequest, conflict, notFound } from '../../utils/errors.js';
import { BrandKit, CAPTION_STYLE_IDS, LOGO_POSITIONS, LOGO_SIZES, type BrandKitDoc } from '../../models/BrandKit.js';
import { CAPTION_POSITIONS, CAPTION_SIZES, Project } from '../../models/Project.js';
import { Asset, toPublicAsset } from '../../models/Asset.js';
import { Workspace } from '../../models/Workspace.js';
import { PLANS, type PlanId } from '../../config/plans.js';
import { audit } from '../../services/audit.service.js';
import { getOrCreateKit } from '../../services/brandKit.service.js';

export { getOrCreateKit, kitFor } from '../../services/brandKit.service.js';

/**
 * Brand kits. `/api/brand-kit` is the workspace's default kit (kept for older clients);
 * `/api/brand-kits` manages all of them (agencies keep one per client).
 */
export const brandKitRouter = Router();
brandKitRouter.use(requireAuth);
export const brandKitsRouter = Router();
brandKitsRouter.use(requireAuth);

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #7C3AED');
const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');

const lookFields = {
  logoAssetId: objectId.nullable(),
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
};
const updateSchema = z.object(lookFields).strict().partial();
const kitUpdateSchema = z
  .object({ ...lookFields, name: z.string().trim().min(1, 'Name the kit.').max(60) })
  .strict()
  .partial();

export async function toPublicKit(kit: BrandKitDoc) {
  const logo = kit.logoAssetId ? await Asset.findOne({ _id: kit.logoAssetId, workspaceId: kit.workspaceId, deletedAt: null, status: 'ready' }) : null;
  return {
    id: kit._id.toString(),
    name: kit.name ?? 'Main brand',
    isDefault: kit.isDefault !== false,
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

async function checkLogo(workspaceId: Types.ObjectId, logoAssetId: string | null | undefined) {
  if (!logoAssetId) return;
  const ok = await Asset.exists({ _id: logoAssetId, workspaceId, deletedAt: null, status: 'ready', kind: 'brand_logo' });
  if (!ok) throw badRequest('That logo is not available. Upload it again.', 'INVALID_ASSET');
}

/* ── Default kit (compatibility) ── */

brandKitRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ data: await toPublicKit(await getOrCreateKit(req.auth!.workspaceId)) });
  }),
);

brandKitRouter.put(
  '/',
  validate({ body: updateSchema }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const body = req.body as z.infer<typeof updateSchema>;
    await checkLogo(workspaceId, body.logoAssetId);
    const kit = await getOrCreateKit(workspaceId);
    kit.set(body);
    await kit.save();
    await audit(req, 'brandkit.updated', { actorId: user._id, workspaceId, metadata: { fields: Object.keys(body) } });
    res.json({ data: await toPublicKit(kit) });
  }),
);

/* ── All kits ── */

async function kitLimit(workspaceId: Types.ObjectId) {
  const ws = await Workspace.findById(workspaceId).select('plan').lean();
  return PLANS[(ws?.plan ?? 'free') as PlanId].brandKits;
}

brandKitsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.auth!;
    await getOrCreateKit(workspaceId);
    const kits = await BrandKit.find({ workspaceId }).sort({ isDefault: -1, createdAt: 1 });
    res.json({ data: await Promise.all(kits.map(toPublicKit)), meta: { limit: await kitLimit(workspaceId) } });
  }),
);

/** A new kit, starting from the default kit's look. */
brandKitsRouter.post(
  '/',
  validate({ body: z.object({ name: z.string().trim().min(1, 'Name the kit.').max(60) }).strict() }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const base = await getOrCreateKit(workspaceId);
    const limit = await kitLimit(workspaceId);
    if ((await BrandKit.countDocuments({ workspaceId })) >= limit) {
      throw new AppError(403, 'PLAN_LIMIT', limit === 1 ? 'Several brand kits are available on the Creator plan and above.' : `Your plan includes ${limit} brand kits. Remove one or upgrade.`);
    }
    const { _id: _i, createdAt: _c, updatedAt: _u, __v: _v, ...look } = base.toObject() as Record<string, unknown>;
    const kit = await BrandKit.create({ ...look, workspaceId, name: (req.body as { name: string }).name, isDefault: false, logoAssetId: null });
    await audit(req, 'brandkit.created', { actorId: user._id, workspaceId, metadata: { kitId: kit._id.toString() } });
    res.status(201).json({ data: await toPublicKit(kit) });
  }),
);

brandKitsRouter.patch(
  '/:id',
  validate({ params: z.object({ id: objectId }), body: kitUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const kit = await BrandKit.findOne({ _id: req.params.id, workspaceId });
    if (!kit) throw notFound('Brand kit not found.');
    const body = req.body as z.infer<typeof kitUpdateSchema>;
    await checkLogo(workspaceId, body.logoAssetId);
    kit.set(body);
    await kit.save();
    await audit(req, 'brandkit.updated', { actorId: user._id, workspaceId, metadata: { kitId: kit._id.toString(), fields: Object.keys(body) } });
    res.json({ data: await toPublicKit(kit) });
  }),
);

/** Makes a kit the default (applied to new projects and to projects without a chosen kit). */
brandKitsRouter.post(
  '/:id/default',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.auth!;
    const kit = await BrandKit.findOne({ _id: req.params.id, workspaceId });
    if (!kit) throw notFound('Brand kit not found.');
    if (!kit.isDefault) {
      await BrandKit.updateMany({ workspaceId, isDefault: true }, { $set: { isDefault: false } });
      kit.isDefault = true;
      await kit.save();
    }
    res.json({ data: await toPublicKit(kit) });
  }),
);

/** Deletes a kit (not the default). Projects that used it fall back to the default kit. */
brandKitsRouter.delete(
  '/:id',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const kit = await BrandKit.findOne({ _id: req.params.id, workspaceId });
    if (!kit) throw notFound('Brand kit not found.');
    if (kit.isDefault) throw conflict('Make another kit the default before deleting this one.', 'DEFAULT_KIT');
    await kit.deleteOne();
    await Project.updateMany({ workspaceId, 'settings.brandKitId': kit._id.toString() }, { $set: { 'settings.brandKitId': null } });
    await audit(req, 'brandkit.deleted', { actorId: user._id, workspaceId, metadata: { kitId: kit._id.toString() } });
    res.status(204).end();
  }),
);
