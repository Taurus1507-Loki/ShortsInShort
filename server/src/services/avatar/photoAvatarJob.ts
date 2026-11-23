import { Types } from 'mongoose';
import { Asset } from '../../models/Asset.js';
import { ConsentRecord } from '../../models/ConsentRecord.js';
import { PhotoAvatar } from '../../models/PhotoAvatar.js';
import type { JobDoc } from '../../models/Job.js';
import { CREDIT_COSTS } from '../../config/credits.js';
import { applyCreditChange } from '../credit.service.js';
import { enqueue, PermanentJobError } from '../queue/queue.js';
import { registerHandler, type JobContext } from '../queue/worker.js';
import { storage } from '../storage/storage.js';
import { AvatarError, getAvatarProvider } from '../ai/avatar.js';
import { logger } from '../../config/logger.js';

/**
 * Personal branding: turns one consented photo into a private talking avatar at the provider.
 * Runs only while consent is active. The one-time creation price is charged when the job starts
 * and refunded if it fails for good.
 */

/** Longest wait for the provider to finish an avatar. */
const READY_TIMEOUT_MS = 15 * 60_000;
let pollMs = 5000;
/** Test seam: how often to check the provider. */
export const setAvatarPollMs = (ms: number) => {
  pollMs = ms;
};

interface Payload {
  avatarId: string;
  credits: number;
}

async function run({ job, signal, progress }: JobContext) {
  const { avatarId } = job.payload as Payload;
  const avatar = await PhotoAvatar.findOne({ _id: avatarId, workspaceId: job.workspaceId, deletedAt: null });
  if (!avatar) throw new PermanentJobError('The avatar was removed.');
  const consent = await ConsentRecord.findById(avatar.consentRecordId);
  if (!consent || consent.status !== 'active') throw new PermanentJobError('Consent is not active.');
  const provider = getAvatarProvider();
  if (!provider) throw new PermanentJobError('Talking presenters are not configured.');

  try {
    if (!avatar.providerLookId) {
      await progress(10, 'uploading_photo');
      const photo = avatar.photoAssetId ? await Asset.findOne({ _id: avatar.photoAssetId, deletedAt: null, status: 'ready' }) : null;
      if (!photo) throw new PermanentJobError('The photo is missing. Upload it again.');
      const created = await provider.createPhotoAvatar({
        photoPath: await storage.getProcessingInput(photo.storageKey),
        mimeType: photo.mimeType ?? 'image/jpeg',
        name: avatar.name,
        idempotencyKey: `sis-avatar-${avatar._id.toString()}`,
        signal,
      });
      avatar.set({ provider: provider.name, providerGroupId: created.groupId, providerLookId: created.lookId });
      await avatar.save();
    }
    await progress(40, 'creating_avatar');
    const started = Date.now();
    for (;;) {
      if (signal.aborted) throw new Error('Processing was cancelled.');
      const look = await provider.getLook(avatar.providerLookId!, signal);
      if (look.status === 'completed') {
        avatar.set({ status: 'ready', previewImageUrl: look.previewImageUrl, failureReason: null });
        await avatar.save();
        return { lookId: avatar.providerLookId };
      }
      if (look.status === 'failed') throw new PermanentJobError(`The provider couldn’t make an avatar from this photo: ${look.failure}. Try a clear, front-facing photo.`);
      if (look.status === 'pending_consent') throw new PermanentJobError('The provider asked for its own consent step for this face, which isn’t supported yet.');
      if (Date.now() - started > READY_TIMEOUT_MS) throw new Error('The avatar is taking unusually long at the provider.');
      await new Promise((r) => setTimeout(r, pollMs));
    }
  } catch (err) {
    // Bad photo, moderation or account problems won't succeed on a retry.
    if (err instanceof AvatarError && err.permanent) throw new PermanentJobError(err.message);
    throw err;
  }
}

async function onDead(job: JobDoc) {
  const { avatarId, credits } = job.payload as Payload;
  await PhotoAvatar.updateOne(
    { _id: avatarId, status: 'creating' },
    { $set: { status: 'failed', failureReason: (job.lastError ?? 'Creating the avatar failed.').slice(0, 300) } },
  );
  if (credits > 0) {
    await applyCreditChange({
      workspaceId: job.workspaceId as Types.ObjectId,
      type: 'refund',
      amount: credits,
      idempotencyKey: `refund:${job._id.toString()}`,
      note: 'Refund for a photo avatar that could not be created',
      reference: { kind: 'job', id: job._id.toString() },
    });
  }
}

export function registerPhotoAvatarJob() {
  registerHandler('create_avatar', { run, onDead });
}

/**
 * Charges the creation price and queues the job. Throws INSUFFICIENT_CREDITS without changing
 * anything when the workspace can't pay. Used when consent becomes active (now, or when the person
 * confirms by email).
 */
export async function startPhotoAvatar(avatarId: Types.ObjectId, workspaceId: Types.ObjectId, actorId: Types.ObjectId | null) {
  const jobId = new Types.ObjectId();
  const credits = CREDIT_COSTS.photoAvatarCreate;
  await applyCreditChange({
    workspaceId,
    type: 'consume',
    amount: -credits,
    idempotencyKey: `job:${jobId.toString()}`,
    note: 'Create photo avatar',
    reference: { kind: 'job', id: jobId.toString() },
    actorId: actorId ?? undefined,
  });
  await PhotoAvatar.updateOne({ _id: avatarId }, { $set: { status: 'creating', lastJobId: jobId, failureReason: null } });
  try {
    await enqueue({ _id: jobId, type: 'create_avatar', workspaceId, payload: { avatarId: avatarId.toString(), credits }, maxAttempts: 3 });
  } catch (err) {
    logger.error({ err }, 'Photo avatar job could not be queued; refunding');
    await applyCreditChange({ workspaceId, type: 'refund', amount: credits, idempotencyKey: `refund:${jobId.toString()}`, note: 'Refund: job could not be queued', reference: { kind: 'job', id: jobId.toString() } });
    await PhotoAvatar.updateOne({ _id: avatarId }, { $set: { status: 'failed', failureReason: 'Could not start. Try again.' } });
    throw err;
  }
}
