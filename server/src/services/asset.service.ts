import { Types } from 'mongoose';
import { fileTypeFromBuffer } from 'file-type';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { PLANS, type PlanId } from '../config/plans.js';
import { Asset, type AssetDoc } from '../models/Asset.js';
import { Workspace } from '../models/Workspace.js';
import { Project } from '../models/Project.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';
import { keys, storage } from './storage/storage.js';
import { probe, runFfmpeg } from './video/ffmpeg.js';
import { extractThumbnail } from './video/render.js';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Container formats we accept, keyed by extension → detected MIME types. */
export const VIDEO_TYPES: Record<string, string[]> = {
  mp4: ['video/mp4'],
  m4v: ['video/mp4', 'video/x-m4v'],
  mov: ['video/quicktime'],
  webm: ['video/webm'],
  mkv: ['video/x-matroska', 'video/matroska'],
};
const ALLOWED_DETECTED = new Set(Object.values(VIDEO_TYPES).flat());

/** Brand logos: raster images only (SVG is excluded — it can carry scripts). */
export const IMAGE_TYPES: Record<string, string[]> = { png: ['image/png'], jpg: ['image/jpeg'], jpeg: ['image/jpeg'], webp: ['image/webp'] };
const ALLOWED_IMAGES = new Set(Object.values(IMAGE_TYPES).flat());
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** Voice samples and consent recordings (browser recordings are WEBM/Opus or MP4/AAC). */
export const AUDIO_TYPES: Record<string, string[]> = {
  mp3: ['audio/mpeg'],
  wav: ['audio/wav', 'audio/x-wav', 'audio/vnd.wave'],
  m4a: ['audio/mp4', 'audio/x-m4a', 'video/mp4'],
  mp4: ['audio/mp4', 'video/mp4'],
  webm: ['audio/webm', 'video/webm'],
  ogg: ['audio/ogg', 'audio/opus'],
};
const ALLOWED_AUDIO = new Set(Object.values(AUDIO_TYPES).flat());
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_AUDIO_SEC = 5 * 60;
export type UploadPurpose = 'video' | 'logo' | 'background' | 'voice_sample' | 'consent';
export const MAX_BACKGROUND_BYTES = 15 * 1024 * 1024;
export const UPLOAD_URL_TTL_SEC = 15 * 60;

export function extensionOf(filename: string): string {
  return (filename.split('.').pop() ?? '').toLowerCase();
}

/* ── Storage quota accounting ───────────────────────────────────────── */

/** Atomically adds bytes to the workspace's usage if it stays within the plan limit. */
export async function reserveStorage(workspaceId: Types.ObjectId, bytes: number): Promise<void> {
  const ws = await Workspace.findById(workspaceId).select('plan').lean();
  if (!ws) throw notFound('Workspace not found.');
  const limit = PLANS[ws.plan as PlanId].storageBytes;
  const r = await Workspace.updateOne(
    { _id: workspaceId, storageBytesUsed: { $lte: limit - bytes } },
    { $inc: { storageBytesUsed: bytes } },
  );
  if (r.modifiedCount === 0) {
    throw new AppError(413, 'STORAGE_FULL', 'Your storage is full. Delete some media or upgrade your plan.');
  }
}

export async function releaseStorage(workspaceId: Types.ObjectId, bytes: number) {
  if (bytes <= 0) return;
  await Workspace.updateOne({ _id: workspaceId }, [
    { $set: { storageBytesUsed: { $max: [0, { $subtract: ['$storageBytesUsed', bytes] }] } } },
  ]);
}

export async function remainingStorage(workspaceId: Types.ObjectId): Promise<number> {
  const ws = await Workspace.findById(workspaceId).select('plan storageBytesUsed').lean();
  if (!ws) return 0;
  return PLANS[ws.plan as PlanId].storageBytes - ws.storageBytesUsed;
}

/* ── Upload lifecycle ───────────────────────────────────────────────── */

export async function initiateUpload(input: {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  filename: string;
  contentType: string;
  sizeBytes: number;
  purpose?: UploadPurpose;
}) {
  const ext = extensionOf(input.filename);
  const background = input.purpose === 'background';
  const logo = input.purpose === 'logo' || background;
  const audio = input.purpose === 'voice_sample' || input.purpose === 'consent';
  if (audio) {
    if (!AUDIO_TYPES[ext] || !/^(audio|video)\//.test(input.contentType)) throw badRequest('Upload an MP3, WAV, M4A, WEBM or OGG recording.', 'UNSUPPORTED_TYPE');
    if (input.sizeBytes > MAX_AUDIO_BYTES) throw new AppError(413, 'TOO_LARGE', 'Recordings can be up to 25 MB.');
  } else if (logo) {
    if (!IMAGE_TYPES[ext] || !input.contentType.startsWith('image/')) throw badRequest('Upload a PNG, JPG or WEBP image.', 'UNSUPPORTED_TYPE');
    const max = background ? MAX_BACKGROUND_BYTES : MAX_LOGO_BYTES;
    if (input.sizeBytes > max) throw new AppError(413, 'TOO_LARGE', background ? 'Background images can be up to 15 MB.' : 'Logos can be up to 5 MB.');
  } else {
    if (!VIDEO_TYPES[ext]) throw badRequest('Upload an MP4, MOV, WEBM or MKV video.', 'UNSUPPORTED_TYPE');
    if (!input.contentType.startsWith('video/')) throw badRequest('Upload a video file.', 'UNSUPPORTED_TYPE');
    if (input.sizeBytes > env.uploads.maxBytes) {
      throw new AppError(413, 'TOO_LARGE', `Videos can be up to ${Math.round(env.uploads.maxBytes / 1024 / 1024)} MB.`);
    }
  }
  if (input.sizeBytes > (await remainingStorage(input.workspaceId))) {
    throw new AppError(413, 'STORAGE_FULL', 'Not enough storage left for this file. Delete some media or upgrade your plan.');
  }

  const id = new Types.ObjectId();
  const storageKey = keys.upload(input.workspaceId.toString(), id.toString(), ext);
  const asset = await Asset.create({
    _id: id,
    workspaceId: input.workspaceId,
    createdBy: input.userId,
    kind: background ? 'background_image' : logo ? 'brand_logo' : input.purpose === 'voice_sample' ? 'voice_sample' : input.purpose === 'consent' ? 'consent_recording' : 'source_video',
    status: 'pending',
    storageKey,
    originalName: input.filename.slice(0, 255),
    mimeType: input.contentType.slice(0, 100),
    declaredSizeBytes: input.sizeBytes,
  });
  // Short-lived: the URL only needs to outlive one upload. (On S3/R2 a presigned PUT can't be made
  // write-once, so the short window plus the render job's own ffprobe re-check is the mitigation.)
  const upload = await storage.createUploadTarget(storageKey, input.contentType, background ? MAX_BACKGROUND_BYTES : logo ? MAX_LOGO_BYTES : audio ? MAX_AUDIO_BYTES : env.uploads.maxBytes, UPLOAD_URL_TTL_SEC);
  return { asset, upload };
}

async function failUpload(asset: AssetDoc, reason: string): Promise<never> {
  asset.status = 'failed';
  asset.failureReason = reason;
  await asset.save();
  await storage.delete(asset.storageKey).catch(() => undefined);
  throw badRequest(reason, 'INVALID_UPLOAD');
}

/**
 * Validates an uploaded object before it can be used: real size (not the declared one), magic-byte
 * content type (not the client's Content-Type or extension), and an FFprobe pass confirming it is a
 * decodable video within the duration limit.
 */
export async function completeUpload(workspaceId: Types.ObjectId, assetId: string): Promise<AssetDoc> {
  const asset = await Asset.findOne({ _id: assetId, workspaceId, deletedAt: null });
  if (!asset) throw notFound('Upload not found.');
  if (asset.status === 'ready') return asset;
  if (asset.status !== 'pending') throw conflict('This upload has already failed. Please upload again.', 'UPLOAD_FAILED');

  const s = await storage.stat(asset.storageKey);
  if (!s || s.size === 0) throw badRequest('The file has not finished uploading.', 'UPLOAD_INCOMPLETE');
  if (s.size > env.uploads.maxBytes) return failUpload(asset, 'The file is larger than allowed.');

  const head = await storage.readHead(asset.storageKey, 4100);
  const detected = await fileTypeFromBuffer(head);
  if (asset.kind === 'brand_logo' || asset.kind === 'background_image') return completeLogo(asset, workspaceId, s.size, detected?.mime);
  if (asset.kind === 'voice_sample' || asset.kind === 'consent_recording') return completeAudio(asset, workspaceId, s.size, detected?.mime);
  if (!detected || !ALLOWED_DETECTED.has(detected.mime)) {
    return failUpload(asset, 'That file isn’t a supported video (MP4, MOV, WEBM or MKV).');
  }

  let info;
  try {
    info = await probe(await storage.getProcessingInput(asset.storageKey));
  } catch (err) {
    logger.warn({ err, assetId }, 'ffprobe rejected upload');
    return failUpload(asset, 'We couldn’t read that video. It may be corrupted.');
  }
  if (!info.video) return failUpload(asset, 'That file has no video track.');
  if (!(info.durationSec > 0.5)) return failUpload(asset, 'That video is too short.');
  if (info.durationSec > env.uploads.maxSourceDurationSec) {
    return failUpload(asset, `Videos can be up to ${Math.round(env.uploads.maxSourceDurationSec / 60)} minutes long.`);
  }

  try {
    await reserveStorage(workspaceId, s.size);
  } catch (err) {
    await failUpload(asset, 'Your storage is full. Delete some media or upgrade your plan.').catch(() => undefined);
    throw err;
  }

  asset.set({
    status: 'ready',
    sizeBytes: s.size,
    countedBytes: s.size,
    mimeType: detected.mime,
    durationSec: Math.round(info.durationSec * 1000) / 1000,
    width: info.video.width,
    height: info.video.height,
    hasAudio: Boolean(info.audio),
  });
  await asset.save();
  await attachThumbnail(asset, info.durationSec).catch((err) => logger.warn({ err, assetId }, 'Source thumbnail failed'));
  return asset;
}

/**
 * Poster frame for an uploaded video (used by the live preview and the Media Library). Taken a
 * second in (or a third of the way into very short clips). Never blocks the upload.
 */
async function attachThumbnail(asset: AssetDoc, durationSec: number) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sis-thumb-'));
  try {
    const file = path.join(dir, 'thumb.jpg');
    await extractThumbnail(await storage.getProcessingInput(asset.storageKey), file, Math.min(1, durationSec / 3));
    const id = new Types.ObjectId();
    const key = keys.thumbnail(asset.workspaceId.toString(), id.toString());
    await storage.uploadFile(key, file, 'image/jpeg');
    await registerGeneratedAsset({
      id,
      workspaceId: asset.workspaceId as Types.ObjectId,
      projectId: null,
      kind: 'thumbnail',
      storageKey: key,
      mimeType: 'image/jpeg',
      sizeBytes: (await stat(file)).size,
      originalName: `${asset.originalName.replace(/\.[^.]+$/, '')}.jpg`,
    });
    asset.thumbnailAssetId = id;
    await asset.save();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Audio validation: real audio container, decodable audio track, 3 s – 5 min. */
async function completeAudio(asset: AssetDoc, workspaceId: Types.ObjectId, size: number, mime: string | undefined): Promise<AssetDoc> {
  if (size > MAX_AUDIO_BYTES) return failUpload(asset, 'Recordings can be up to 25 MB.');
  if (!mime || !ALLOWED_AUDIO.has(mime)) return failUpload(asset, 'That file isn’t a supported recording (MP3, WAV, M4A, WEBM or OGG).');
  let info;
  try {
    info = await probe(await storage.getProcessingInput(asset.storageKey));
  } catch {
    return failUpload(asset, 'We couldn’t read that recording. It may be corrupted.');
  }
  if (!info.audio) return failUpload(asset, 'That file has no audio.');
  // Browser WEBM recordings often carry no duration header; fall back to decoding the length.
  const duration = info.durationSec > 0 ? info.durationSec : await measureAudioSec(await storage.getProcessingInput(asset.storageKey));
  if (!(duration >= 3)) return failUpload(asset, 'That recording is too short (at least 3 seconds).');
  if (duration > MAX_AUDIO_SEC) return failUpload(asset, 'Recordings can be up to 5 minutes long.');
  await reserveStorage(workspaceId, size);
  asset.set({ status: 'ready', sizeBytes: size, countedBytes: size, mimeType: mime, durationSec: Math.round(duration * 1000) / 1000, hasAudio: true });
  await asset.save();
  return asset;
}

/** Decodes the audio to find its real length (for files without a duration header). */
async function measureAudioSec(input: string): Promise<number> {
  try {
    const { stderr } = await runFfmpeg(['-i', input, '-vn', '-f', 'null', '-']);
    const all = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    const m = all[all.length - 1];
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  } catch {
    return 0;
  }
}

/** Logo validation: real image type, decodable, sensible dimensions. */
async function completeLogo(asset: AssetDoc, workspaceId: Types.ObjectId, size: number, mime: string | undefined): Promise<AssetDoc> {
  const bg = asset.kind === 'background_image';
  if (size > (bg ? MAX_BACKGROUND_BYTES : MAX_LOGO_BYTES)) return failUpload(asset, bg ? 'Background images can be up to 15 MB.' : 'Logos can be up to 5 MB.');
  if (!mime || !ALLOWED_IMAGES.has(mime)) return failUpload(asset, 'That file isn’t a PNG, JPG or WEBP image.');
  let info;
  try {
    info = await probe(await storage.getProcessingInput(asset.storageKey));
  } catch {
    return failUpload(asset, 'We couldn’t read that image. It may be corrupted.');
  }
  const w = info.video?.width ?? 0;
  const h = info.video?.height ?? 0;
  if (bg ? w < 320 || h < 320 || w > 8000 || h > 8000 : w < 32 || h < 32 || w > 6000 || h > 6000) {
    return failUpload(asset, bg ? 'Background images must be between 320 and 8000 pixels on each side.' : 'Logos must be between 32 and 6000 pixels on each side.');
  }
  await reserveStorage(workspaceId, size);
  asset.set({ status: 'ready', sizeBytes: size, countedBytes: size, mimeType: mime, width: w, height: h });
  await asset.save();
  return asset;
}

/** Records a worker-produced file (render/thumbnail) and counts it against storage. */
export async function registerGeneratedAsset(input: {
  id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId | null;
  kind: 'render' | 'thumbnail' | 'narration_audio';
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  durationSec?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  thumbnailAssetId?: Types.ObjectId | null;
}) {
  // Outputs are counted but never blocked: the user already paid credits for this render.
  await Workspace.updateOne({ _id: input.workspaceId }, { $inc: { storageBytesUsed: input.sizeBytes } });
  return Asset.create({ ...input, _id: input.id, status: 'ready', countedBytes: input.sizeBytes });
}

export async function deleteAsset(workspaceId: Types.ObjectId, assetId: string) {
  const asset = await Asset.findOne({ _id: assetId, workspaceId, deletedAt: null });
  if (!asset) throw notFound('File not found.');
  if (asset.kind === 'voice_sample' || asset.kind === 'consent_recording') {
    throw conflict('Voice recordings are removed together with their custom voice (AI Voices page).', 'ASSET_MANAGED');
  }
  const busy = await Project.exists({
    workspaceId,
    deletedAt: null,
    status: { $in: ['queued', 'processing'] },
    $or: [{ sourceAssetId: asset._id }, { backgroundAssetId: asset._id }, { narrationAssetId: asset._id }],
  });
  if (busy) throw conflict('This video is being processed. Try again when it finishes.', 'ASSET_BUSY');
  await purgeAsset(asset);
}

/** Soft-deletes an asset (and its thumbnail), frees its storage and removes the bytes. */
export async function purgeAsset(asset: AssetDoc) {
  const workspaceId = asset.workspaceId as Types.ObjectId;
  const assetId = asset._id.toString();
  asset.deletedAt = new Date();
  await asset.save();
  await releaseStorage(workspaceId, asset.countedBytes);
  await storage.delete(asset.storageKey).catch((err) => logger.warn({ err, assetId }, 'Storage delete failed'));
  await Project.updateMany({ workspaceId, sourceAssetId: asset._id }, { $set: { sourceAssetId: null } });
  await Project.updateMany({ workspaceId, outputAssetId: asset._id }, { $set: { outputAssetId: null } });
  await Project.updateMany({ workspaceId, narrationAssetId: asset._id }, { $set: { narrationAssetId: null } });
  await Project.updateMany({ workspaceId, backgroundAssetId: asset._id }, { $set: { backgroundAssetId: null } });

  if (asset.thumbnailAssetId) {
    const thumb = await Asset.findOne({ _id: asset.thumbnailAssetId, workspaceId, deletedAt: null });
    if (thumb) {
      thumb.deletedAt = new Date();
      await thumb.save();
      await releaseStorage(workspaceId, thumb.countedBytes);
      await storage.delete(thumb.storageKey).catch(() => undefined);
    }
  }
}

/** Removes pending uploads abandoned for more than a day. */
export async function sweepAbandonedUploads() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await Asset.find({ status: 'pending', createdAt: { $lt: cutoff } }).limit(100);
  for (const a of stale) {
    await storage.delete(a.storageKey).catch(() => undefined);
    a.status = 'failed';
    a.failureReason = 'Upload was not completed.';
    a.deletedAt = new Date();
    await a.save();
  }
}
