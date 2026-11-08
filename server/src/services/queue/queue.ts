import { Types } from 'mongoose';
import { Job, type JobDoc, type JobType } from '../../models/Job.js';

/**
 * Durable job queue on MongoDB.
 *
 * - Claiming is a single atomic findOneAndUpdate, so any number of worker processes can poll
 *   safely without double-processing.
 * - Workers hold a lease (`lockedUntil`) renewed by heartbeats; if a worker dies, the lease expires
 *   and the job is reclaimed (counting as an attempt).
 * - Failures retry with exponential backoff; exhausted or permanent failures go to `dead`
 *   (the dead-letter state), which triggers compensation such as credit refunds.
 *
 * The interface is deliberately small so it can be backed by Redis/BullMQ later without touching
 * callers.
 */

export const LEASE_MS = 60_000;

export class PermanentJobError extends Error {
  readonly permanent = true;
}

export async function enqueue(input: {
  _id?: Types.ObjectId;
  type: JobType;
  workspaceId: Types.ObjectId;
  projectId?: Types.ObjectId | null;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
}): Promise<JobDoc> {
  return Job.create({ ...input, status: 'queued', runAt: new Date() });
}

export async function claim(workerId: string, types: JobType[]): Promise<JobDoc | null> {
  const now = new Date();
  return Job.findOneAndUpdate(
    {
      type: { $in: types },
      $or: [
        { status: 'queued', runAt: { $lte: now } },
        // Lease expired (worker crashed) and attempts remain → reclaim.
        { status: 'active', lockedUntil: { $lt: now }, $expr: { $lt: ['$attempts', '$maxAttempts'] } },
      ],
    },
    {
      $set: { status: 'active', lockedBy: workerId, lockedUntil: new Date(now.getTime() + LEASE_MS), startedAt: now, stage: 'starting' },
      $inc: { attempts: 1 },
    },
    { sort: { priority: -1, runAt: 1 }, new: true },
  );
}

/** Renews the lease and records progress. Returns false if this worker lost the job. */
export async function heartbeat(jobId: Types.ObjectId, workerId: string, update: { progress?: number; stage?: string } = {}) {
  const set: Record<string, unknown> = { lockedUntil: new Date(Date.now() + LEASE_MS) };
  if (update.progress !== undefined) set.progress = Math.max(0, Math.min(100, Math.round(update.progress)));
  if (update.stage) set.stage = update.stage;
  const r = await Job.updateOne({ _id: jobId, lockedBy: workerId, status: 'active' }, { $set: set });
  return r.matchedCount === 1;
}

export async function complete(jobId: Types.ObjectId, workerId: string, result: unknown) {
  await Job.updateOne(
    { _id: jobId, lockedBy: workerId },
    { $set: { status: 'completed', result, progress: 100, stage: 'done', finishedAt: new Date(), lockedBy: null, lockedUntil: null } },
  );
}

/** Records a failure. Returns 'retry' or 'dead'. */
export async function fail(job: JobDoc, workerId: string, err: unknown): Promise<'retry' | 'dead'> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
  const permanent = Boolean((err as { permanent?: boolean })?.permanent);
  if (!permanent && job.attempts < job.maxAttempts) {
    const backoffMs = Math.min(5 * 60_000, 5_000 * 2 ** (job.attempts - 1));
    await Job.updateOne(
      { _id: job._id, lockedBy: workerId },
      { $set: { status: 'queued', lastError: message, runAt: new Date(Date.now() + backoffMs), lockedBy: null, lockedUntil: null, stage: 'retrying' } },
    );
    return 'retry';
  }
  await Job.updateOne(
    { _id: job._id, lockedBy: workerId },
    { $set: { status: 'dead', lastError: message, finishedAt: new Date(), lockedBy: null, lockedUntil: null, stage: 'failed' } },
  );
  return 'dead';
}

/** Finds jobs whose worker died on the final attempt and moves them to the dead-letter state. */
export async function sweepExpired(): Promise<JobDoc[]> {
  const now = new Date();
  const dead: JobDoc[] = [];
  for (;;) {
    const j = await Job.findOneAndUpdate(
      { status: 'active', lockedUntil: { $lt: now }, $expr: { $gte: ['$attempts', '$maxAttempts'] } },
      { $set: { status: 'dead', lastError: 'The worker stopped responding while processing.', finishedAt: now, lockedBy: null, lockedUntil: null, stage: 'failed' } },
      { new: true },
    );
    if (!j) break;
    dead.push(j);
  }
  return dead;
}
