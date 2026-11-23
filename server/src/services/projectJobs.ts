import { Types } from 'mongoose';
import { Project, type ProjectDoc } from '../models/Project.js';
import type { JobType } from '../models/Job.js';
import { applyCreditChange } from './credit.service.js';
import { enqueue } from './queue/queue.js';
import { conflict } from '../utils/errors.js';

/**
 * Starts a project job (used by the API and by batch autopilot):
 * 1. claim the project (draft/completed/failed → queued) so two jobs can't run at once,
 * 2. debit credits with an idempotency key bound to the new job id (refunded if the job dies),
 * 3. enqueue the job.
 */
export async function startJob(opts: {
  workspaceId: Types.ObjectId;
  actorId: Types.ObjectId;
  project: ProjectDoc;
  type: JobType;
  credits: number;
  note: string;
  payload?: Record<string, unknown>;
}) {
  const { workspaceId, project } = opts;
  const jobId = new Types.ObjectId();
  const previousStatus = project.status;
  const claimed = await Project.findOneAndUpdate(
    { _id: project._id, workspaceId, status: { $in: ['draft', 'completed', 'failed'] } },
    { $set: { status: 'queued', lastJobId: jobId, lastError: null } },
    { new: true },
  );
  if (!claimed) throw conflict('This project is already being processed.', 'PROJECT_BUSY');

  try {
    if (opts.credits > 0)
      await applyCreditChange({
        workspaceId,
        type: 'consume',
        amount: -opts.credits,
        idempotencyKey: `job:${jobId.toString()}`,
        note: `${opts.note}: ${project.title}`.slice(0, 300),
        reference: { kind: 'job', id: jobId.toString() },
        actorId: opts.actorId,
      });
  } catch (err) {
    await Project.updateOne({ _id: project._id, lastJobId: jobId }, { $set: { status: previousStatus } });
    throw err;
  }

  try {
    return await enqueue({
      _id: jobId,
      type: opts.type,
      workspaceId,
      projectId: project._id,
      payload: { projectId: project._id.toString(), credits: opts.credits, ...opts.payload },
      maxAttempts: 3,
    });
  } catch (err) {
    // Never leave credits charged for a job that doesn't exist, or a project stuck in `queued`.
    // The refund key matches the worker's, so even a racing compensation can only refund once.
    if (opts.credits > 0)
      await applyCreditChange({
        workspaceId,
        type: 'refund',
        amount: opts.credits,
        idempotencyKey: `refund:${jobId.toString()}`,
        note: 'Refund: job could not be queued',
        reference: { kind: 'job', id: jobId.toString() },
      });
    await Project.updateOne({ _id: project._id, lastJobId: jobId }, { $set: { status: previousStatus } });
    throw err;
  }
}
