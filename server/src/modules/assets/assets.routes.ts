import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth, requireVerifiedEmail } from '../../middleware/auth.js';
import { validate, validatedQuery } from '../../middleware/validate.js';
import { asyncHandler, notFound } from '../../utils/errors.js';
import { Asset, ASSET_KINDS, toPublicAsset } from '../../models/Asset.js';
import { completeUpload, deleteAsset, initiateUpload } from '../../services/asset.service.js';
import { storage } from '../../services/storage/storage.js';
import { audit } from '../../services/audit.service.js';

export const assetsRouter = Router();
assetsRouter.use(requireAuth);

const idParams = z.object({ id: z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id') });

/** Step 1: register the upload and get a signed PUT target (bytes go straight to storage). */
assetsRouter.post(
  '/uploads',
  requireVerifiedEmail,
  validate({
    body: z
      .object({
        filename: z.string().trim().min(1).max(255),
        contentType: z.string().trim().min(1).max(100),
        sizeBytes: z.number().int().positive(),
      })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const { asset, upload } = await initiateUpload({ workspaceId, userId: user._id, ...req.body });
    res.status(201).json({ data: { asset: toPublicAsset(asset), upload } });
  }),
);

/** Step 2: verify the uploaded bytes (size, magic bytes, ffprobe) and mark the asset ready. */
assetsRouter.post(
  '/:id/complete',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const asset = await completeUpload(workspaceId, req.params.id!);
    await audit(req, 'asset.uploaded', { actorId: user._id, workspaceId, metadata: { assetId: req.params.id, bytes: asset.sizeBytes } });
    res.json({ data: toPublicAsset(asset) });
  }),
);

const listQuery = z.object({
  kind: z.enum(ASSET_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

assetsRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<z.infer<typeof listQuery>>(req);
    const filter: Record<string, unknown> = {
      workspaceId: req.auth!.workspaceId,
      deletedAt: null,
      status: 'ready',
      kind: q.kind ?? { $in: ['source_video', 'render'] },
    };
    const [items, total] = await Promise.all([
      Asset.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
      Asset.countDocuments(filter),
    ]);
    res.json({ data: items.map(toPublicAsset), meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) } });
  }),
);

/** Short-lived signed URL for playback or download. */
assetsRouter.get(
  '/:id/url',
  validate({ params: idParams, query: z.object({ download: z.enum(['0', '1']).optional() }) }),
  asyncHandler(async (req, res) => {
    const asset = await Asset.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId, deletedAt: null, status: 'ready' });
    if (!asset) throw notFound('File not found.');
    const download = validatedQuery<{ download?: string }>(req).download === '1';
    const expiresSec = 3600;
    const base = (asset.originalName || 'video').replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').slice(0, 80) || 'video';
    const ext = asset.mimeType === 'image/jpeg' ? 'jpg' : asset.storageKey.split('.').pop();
    const url = await storage.getDownloadUrl(asset.storageKey, { expiresSec, downloadName: download ? `${base}.${ext}` : undefined });
    res.json({ data: { url, expiresAt: new Date(Date.now() + expiresSec * 1000).toISOString() } });
  }),
);

assetsRouter.delete(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    await deleteAsset(workspaceId, req.params.id!);
    await audit(req, 'asset.deleted', { actorId: user._id, workspaceId, metadata: { assetId: req.params.id } });
    res.status(204).end();
  }),
);
