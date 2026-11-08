import { Schema, model, type HydratedDocument, type InferSchemaType, Types } from 'mongoose';

export const JOB_TYPES = ['render_project'] as const;
export type JobType = (typeof JOB_TYPES)[number];
/** queued → active → completed | (retry → queued) | dead (dead-letter: exhausted or permanent failure) */
export const JOB_STATUSES = ['queued', 'active', 'completed', 'dead', 'cancelled'] as const;

const jobSchema = new Schema(
  {
    type: { type: String, enum: JOB_TYPES, required: true },
    status: { type: String, enum: JOB_STATUSES, default: 'queued', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    payload: { type: Schema.Types.Mixed, default: {} },
    priority: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    runAt: { type: Date, default: () => new Date() },
    lockedBy: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    stage: { type: String, default: 'queued', maxlength: 40 },
    lastError: { type: String, default: null, maxlength: 1000 },
    result: { type: Schema.Types.Mixed, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Claim query: queued & due, highest priority first, oldest first.
jobSchema.index({ status: 1, priority: -1, runAt: 1 });
jobSchema.index({ status: 1, lockedUntil: 1 });
jobSchema.index({ projectId: 1, createdAt: -1 });

export type JobDoc = HydratedDocument<InferSchemaType<typeof jobSchema>>;
export const Job = model('Job', jobSchema);

export function toPublicJob(j: JobDoc) {
  return {
    id: (j._id as Types.ObjectId).toString(),
    type: j.type,
    status: j.status,
    stage: j.stage,
    progress: j.progress,
    attempts: j.attempts,
    maxAttempts: j.maxAttempts,
    error: j.status === 'dead' ? j.lastError : null,
    createdAt: j.get('createdAt') as Date,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
  };
}
