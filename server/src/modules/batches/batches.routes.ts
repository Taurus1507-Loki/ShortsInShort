import { Router, type Request } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth, requireVerifiedEmail } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { jobStartLimiter } from '../../middleware/security.js';
import { AppError, asyncHandler, badRequest, notFound } from '../../utils/errors.js';
import { Batch, toPublicBatch } from '../../models/Batch.js';
import { Project, toPublicProject } from '../../models/Project.js';
import { Workspace } from '../../models/Workspace.js';
import { PLANS, type PlanId } from '../../config/plans.js';
import { MAX_NARRATION_CHARS, resolutionAllowed } from '../../config/credits.js';
import { getTtsProvider, listVoicesCached } from '../../services/ai/tts.js';
import { getStockProvider } from '../../services/ai/stock.js';
import { ownCustomVoice } from '../../services/voice/consent.js';
import { estimateVideo } from '../../services/batch/autopilot.js';
import { startJob } from '../../services/projectJobs.js';
import { audit } from '../../services/audit.service.js';
import { projectFields, settingsSchema } from '../projects/projects.schemas.js';

/**
 * Batch create: one template + one voice + many scripts → many finished Faceless videos. Each script
 * becomes its own project that runs voiceover → scenes → export automatically (see autopilot.ts).
 */
export const batchesRouter = Router();
batchesRouter.use(requireAuth);

export const MAX_BATCH_VIDEOS = 30;

const batchBody = z
  .object({
    name: z.string().trim().min(1, 'Name the batch.').max(120),
    templateId: z.string().trim().max(60).optional(),
    aspectRatio: projectFields.aspectRatio.default('9:16'),
    style: projectFields.style.default('viral'),
    settings: settingsSchema,
    videos: z
      .array(
        z
          .object({
            title: z.string().trim().max(120).optional(),
            script: z
              .string()
              .trim()
              .min(20, 'Each script needs at least a sentence or two.')
              .max(MAX_NARRATION_CHARS, `Each script can be up to ${MAX_NARRATION_CHARS} characters.`),
          })
          .strict(),
      )
      .min(1, 'Add at least one script.')
      .max(MAX_BATCH_VIDEOS, `Up to ${MAX_BATCH_VIDEOS} videos per batch.`),
  })
  .strict();
type BatchBody = z.infer<typeof batchBody>;

/** Checks a batch can run and prices it: voiceovers + estimated exports. */
async function batchQuote(req: Request, body: BatchBody) {
  const { workspaceId } = req.auth!;
  const motion = body.settings.facelessStyle === 'motion';
  if (!getTtsProvider()) throw new AppError(503, 'NOT_CONFIGURED', 'AI voices are not configured on this server.');
  if (!motion && !getStockProvider()) throw new AppError(503, 'NOT_CONFIGURED', 'Stock footage is not configured on this server.');
  const voiceId = body.settings.voiceId ?? '';
  if (!voiceId) throw badRequest('Choose a voice first.', 'NO_VOICE');
  let voiceName: string | undefined;
  const custom = await ownCustomVoice(workspaceId, voiceId);
  if (custom) voiceName = custom.name;
  else {
    try {
      voiceName = (await listVoicesCached()).find((v) => v.id === voiceId)?.name;
    } catch {
      throw new AppError(502, 'PROVIDER_ERROR', 'Could not reach the voice provider. Try again shortly.');
    }
  }
  if (!voiceName) throw badRequest('That voice is no longer available. Choose another one.', 'INVALID_VOICE');
  const ws = await Workspace.findById(workspaceId).select('plan creditBalance').lean();
  const plan = PLANS[(ws?.plan ?? 'free') as PlanId];
  const resolution = body.settings.resolution ?? '1080p';
  if (!resolutionAllowed(resolution, plan.maxResolution)) throw new AppError(403, 'PLAN_LIMIT', `Your plan exports up to ${plan.maxResolution}. Lower the resolution or upgrade.`);
  const videos = body.videos.map((v) => estimateVideo(v.script, { motion, resolution }));
  return { videos, total: videos.reduce((t, v) => t + v.total, 0), balance: ws?.creditBalance ?? 0, voiceName };
}

/** Price of a batch before starting it. */
batchesRouter.post(
  '/estimate',
  validate({ body: batchBody }),
  asyncHandler(async (req, res) => {
    const { voiceName: _voice, ...q } = await batchQuote(req, req.body as BatchBody);
    res.json({ data: q });
  }),
);

/** Creates the videos and starts their voiceovers; each then continues on its own. */
batchesRouter.post(
  '/',
  jobStartLimiter,
  requireVerifiedEmail,
  validate({ body: batchBody }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const body = req.body as BatchBody;
    const q = await batchQuote(req, body);
    if (q.balance < q.total) {
      throw new AppError(402, 'INSUFFICIENT_CREDITS', `This batch needs about ${q.total} credits and you have ${q.balance}. Remove some scripts or top up.`);
    }
    const batch = await Batch.create({ workspaceId, createdBy: user._id, name: body.name, templateId: body.templateId ?? null, estimatedCredits: q.total });
    const projects = [];
    for (const [i, v] of body.videos.entries()) {
      projects.push(
        await Project.create({
          title: (v.title || `${body.name} #${i + 1}`).slice(0, 120),
          mode: 'faceless',
          aspectRatio: body.aspectRatio,
          style: body.style,
          script: v.script,
          topic: '',
          settings: body.settings,
          workspaceId,
          createdBy: user._id,
          batchId: batch._id,
          autopilot: { state: 'running', error: null },
        }),
      );
    }
    batch.projectIds = projects.map((p) => p._id);
    await batch.save();
    let started = 0;
    for (const [i, p] of projects.entries()) {
      try {
        await startJob({
          workspaceId,
          actorId: user._id,
          project: p,
          type: 'narrate_project',
          credits: q.videos[i]!.narration,
          note: 'Voiceover (batch)',
          payload: { voiceId: body.settings.voiceId, voiceName: q.voiceName },
        });
        started++;
      } catch (err) {
        await Project.updateOne({ _id: p._id }, { $set: { 'autopilot.state': 'stopped', 'autopilot.error': err instanceof Error ? err.message.slice(0, 300) : 'Could not start.' } });
      }
    }
    await audit(req, 'batch.created', { actorId: user._id, workspaceId, metadata: { batchId: batch._id.toString(), videos: projects.length, estimatedCredits: q.total } });
    res.status(201).json({ data: { batch: toPublicBatch(batch), started } });
  }),
);

/** The workspace's batches, newest first, with progress counts. */
batchesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const batches = await Batch.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: -1 }).limit(50);
    const rows = await Project.find({ _id: { $in: batches.flatMap((b) => b.projectIds) }, deletedAt: null }).select('batchId autopilot').lean();
    res.json({
      data: batches.map((b) => {
        const mine = rows.filter((r) => r.batchId?.equals(b._id));
        return {
          ...toPublicBatch(b),
          videos: mine.length,
          done: mine.filter((r) => r.autopilot?.state === 'done').length,
          stopped: mine.filter((r) => r.autopilot?.state === 'stopped').length,
        };
      }),
    });
  }),
);

/** One batch with its videos (status, current step, error, finished video). */
batchesRouter.get(
  '/:id',
  validate({ params: z.object({ id: z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid batch id') }) }),
  asyncHandler(async (req, res) => {
    const batch = await Batch.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!batch) throw notFound('Batch not found.');
    const projects = await Project.find({ _id: { $in: batch.projectIds }, deletedAt: null });
    const order = new Map(batch.projectIds.map((id, i) => [id.toString(), i]));
    projects.sort((a, b) => (order.get(a._id.toString()) ?? 0) - (order.get(b._id.toString()) ?? 0));
    res.json({ data: { batch: toPublicBatch(batch), projects: projects.map(toPublicProject) } });
  }),
);
