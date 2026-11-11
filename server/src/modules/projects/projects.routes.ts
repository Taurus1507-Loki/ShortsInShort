import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth, requireVerifiedEmail } from '../../middleware/auth.js';
import { validate, validatedQuery } from '../../middleware/validate.js';
import { AppError, asyncHandler, badRequest, conflict, notFound } from '../../utils/errors.js';
import { Project, toPublicProject, type ProjectDoc } from '../../models/Project.js';
import { Asset, toPublicAsset } from '../../models/Asset.js';
import { Job, toPublicJob } from '../../models/Job.js';
import { Workspace } from '../../models/Workspace.js';
import { PLANS, type PlanId } from '../../config/plans.js';
import { avatarCreditCost, editorCreditCost, facelessCreditCost, MAX_NARRATION_CHARS, narrationCreditCost, resolutionAllowed } from '../../config/credits.js';
import { getAvatarProvider, listAvatarsCached } from '../../services/ai/avatar.js';
import { KEY_GREEN } from '../../services/video/renderJob.js';
import { getStockProvider } from '../../services/ai/stock.js';
import { MAX_SCENES, fallbackQuery, findClips, planSceneQueries, scenesKey, scriptFromScenes, splitSceneText, splitScenes } from '../../services/faceless/scenes.js';
import { getLLMProvider } from '../../services/ai/llm.js';
import { logger } from '../../config/logger.js';
import { applyCreditChange } from '../../services/credit.service.js';
import { enqueue } from '../../services/queue/queue.js';
import { audit } from '../../services/audit.service.js';
import { getTtsProvider, listVoicesCached } from '../../services/ai/tts.js';
import { ownCustomVoice } from '../../services/voice/consent.js';
import { scriptHash } from '../../services/audio/narrationJob.js';
import { CustomVoice } from '../../models/CustomVoice.js';
import type { JobType } from '../../models/Job.js';
import type { Request } from 'express';
import { createProjectSchema, idParams, listProjectsQuery, updateProjectSchema } from './projects.schemas.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every query below is scoped by the caller's workspaceId: that is the tenant-isolation boundary.

async function assertUsableSource(workspaceId: Types.ObjectId, assetId: string) {
  const asset = await Asset.findOne({ _id: assetId, workspaceId, deletedAt: null, kind: 'source_video', status: 'ready' });
  if (!asset) throw badRequest('That video is not available. Upload it again.', 'INVALID_ASSET');
  return asset;
}

/** Background for voiceover videos: an uploaded image, or one of the workspace's ready videos. */
async function assertUsableBackground(workspaceId: Types.ObjectId, assetId: string) {
  const asset = await Asset.findOne({ _id: assetId, workspaceId, deletedAt: null, status: 'ready', kind: { $in: ['background_image', 'source_video'] } });
  if (!asset) throw badRequest('That background is not available. Upload it again.', 'INVALID_ASSET');
  return asset;
}

/** Project + its source/output asset summaries. */
async function withMedia(p: ProjectDoc) {
  const ids = [p.sourceAssetId, p.outputAssetId, p.narrationAssetId, p.backgroundAssetId].filter(Boolean) as Types.ObjectId[];
  const assets = ids.length ? await Asset.find({ _id: { $in: ids }, workspaceId: p.workspaceId, deletedAt: null }) : [];
  const find = (id: Types.ObjectId | null | undefined) => {
    const a = id && assets.find((x) => x._id.equals(id));
    return a ? toPublicAsset(a) : null;
  };
  return { ...toPublicProject(p), sourceAsset: find(p.sourceAssetId), outputAsset: find(p.outputAssetId), narrationAsset: find(p.narrationAssetId), backgroundAsset: find(p.backgroundAssetId),
    // Faceless: the scene plan no longer matches the script.
    scenesOutdated: p.mode === 'faceless' && (p.scenes?.length ?? 0) > 0 && p.scenesKey !== scenesKey(p.script ?? '') };
}

projectsRouter.get(
  '/',
  validate({ query: listProjectsQuery }),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<z.infer<typeof listProjectsQuery>>(req);
    const filter: Record<string, unknown> = { workspaceId: req.auth!.workspaceId, deletedAt: null };
    if (q.status) filter.status = q.status;
    if (q.mode) filter.mode = q.mode;
    if (q.q) filter.title = { $regex: escapeRegex(q.q), $options: 'i' };

    const [items, total] = await Promise.all([
      Project.find(filter).sort({ updatedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
      Project.countDocuments(filter),
    ]);
    res.json({
      data: items.map(toPublicProject),
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
    });
  }),
);

projectsRouter.post(
  '/',
  requireVerifiedEmail,
  validate({ body: createProjectSchema }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const body = req.body as z.infer<typeof createProjectSchema>;
    if (body.sourceAssetId) await assertUsableSource(workspaceId, body.sourceAssetId);
    if (body.backgroundAssetId) await assertUsableBackground(workspaceId, body.backgroundAssetId);
    const project = await Project.create({ ...body, workspaceId, createdBy: user._id });
    await audit(req, 'project.created', { actorId: user._id, workspaceId, metadata: { projectId: project._id.toString() } });
    res.status(201).json({ data: await withMedia(project) });
  }),
);

projectsRouter.get(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const project = await Project.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId, deletedAt: null });
    if (!project) throw notFound('Project not found.');
    res.json({ data: await withMedia(project) });
  }),
);

projectsRouter.patch(
  '/:id',
  validate({ params: idParams, body: updateProjectSchema }),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.auth!;
    const project = await Project.findOne({ _id: req.params.id, workspaceId, deletedAt: null });
    if (!project) throw notFound('Project not found.');
    if (project.status === 'queued' || project.status === 'processing') {
      throw conflict('This project is being processed and cannot be edited right now.', 'PROJECT_BUSY');
    }
    const { settings, sourceAssetId, backgroundAssetId, ...rest } = req.body as z.infer<typeof updateProjectSchema>;
    if (sourceAssetId) await assertUsableSource(workspaceId, sourceAssetId);
    if (backgroundAssetId) await assertUsableBackground(workspaceId, backgroundAssetId);
    if (backgroundAssetId !== undefined) project.set('backgroundAssetId', backgroundAssetId);
    project.set(rest);
    if (sourceAssetId !== undefined) project.set('sourceAssetId', sourceAssetId);
    if (settings) project.set('settings', { ...project.toObject().settings, ...settings });
    await project.save();
    res.json({ data: await withMedia(project) });
  }),
);

projectsRouter.delete(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const r = await Project.updateOne(
      { _id: req.params.id, workspaceId, deletedAt: null, status: { $nin: ['queued', 'processing'] } },
      { deletedAt: new Date() },
    );
    if (r.matchedCount === 0) throw notFound('Project not found or currently processing.');
    await audit(req, 'project.deleted', { actorId: user._id, workspaceId, metadata: { projectId: req.params.id } });
    res.status(204).end();
  }),
);

/* ── Generation ─────────────────────────────────────────────────────── */

/**
 * Voiceover video (Avatar Studio without an avatar provider): needs an up-to-date voiceover, a usable
 * background, and — for a cloned voice — consent that is still active. Priced like the editor:
 * 1 credit per started minute of the voiceover (×2 for 4K).
 */
async function avatarQuote(project: ProjectDoc, workspaceId: Types.ObjectId) {
  const stats = project.narrationStats;
  const narration = project.narrationAssetId
    ? await Asset.findOne({ _id: project.narrationAssetId, workspaceId, deletedAt: null, status: 'ready', kind: 'narration_audio' })
    : null;
  if (!narration || !stats) throw badRequest('Generate the voiceover first.', 'NO_NARRATION');
  const s = project.settings ?? {};
  const background = s.background ?? 'brand';
  const avatarId = s.avatarId ?? '';
  const layout = s.avatarLayout ?? 'full';
  let presenterCredits = 0;
  let presenterReused = false;
  if (avatarId) {
    if (!getAvatarProvider()) throw new AppError(503, 'NOT_CONFIGURED', 'Talking presenters are not configured on this server.');
    let avatars;
    try {
      avatars = await listAvatarsCached();
    } catch {
      throw new AppError(502, 'PROVIDER_ERROR', 'Could not reach the avatar provider. Try again shortly.');
    }
    if (!avatars.some((a) => a.id === avatarId)) throw badRequest('That presenter is no longer available. Choose another one.', 'INVALID_AVATAR');
    const ar = project.avatarRender;
    const color = layout === 'overlay' ? KEY_GREEN : (s.backgroundColor ?? '#1E1B4B');
    presenterReused = Boolean(
      ar?.assetId && ar.avatarId === avatarId && ar.narrationAssetId?.equals(narration._id) && ar.backgroundColor === color && ar.aspectRatio === project.aspectRatio &&
        (await Asset.exists({ _id: ar.assetId, workspaceId, deletedAt: null, status: 'ready' })),
    );
    if (!presenterReused) presenterCredits = avatarCreditCost(narration.durationSec ?? stats.durationSec ?? 0);
  }
  if ((background === 'image' || background === 'video') && !(avatarId && layout === 'full')) {
    const bg = project.backgroundAssetId ? await Asset.findOne({ _id: project.backgroundAssetId, workspaceId, deletedAt: null, status: 'ready' }) : null;
    if (!bg || (background === 'image' ? bg.kind !== 'background_image' : bg.kind !== 'source_video')) {
      throw badRequest(`Choose a background ${background} first.`, 'NO_BACKGROUND');
    }
  }
  if (stats.voiceId && (await CustomVoice.exists({ workspaceId, providerVoiceId: stats.voiceId })) && !(await ownCustomVoice(workspaceId, stats.voiceId))) {
    throw new AppError(409, 'VOICE_WITHDRAWN', 'Consent for this custom voice was withdrawn, so its voiceover can’t be used in new videos. Choose another voice and generate the voiceover again.');
  }
  const ws = await Workspace.findById(workspaceId).select('plan creditBalance').lean();
  const plan = PLANS[(ws?.plan ?? 'free') as PlanId];
  const resolution = s.resolution ?? '1080p';
  const durationSec = narration.durationSec ?? stats.durationSec ?? 0;
  return {
    credits: editorCreditCost(durationSec, resolution) + presenterCredits,
    presenterCredits,
    presenterReused,
    balance: ws?.creditBalance ?? 0,
    sourceDurationSec: durationSec,
    resolution,
    resolutionAllowed: resolutionAllowed(resolution, plan.maxResolution),
    planMaxResolution: plan.maxResolution,
    narrationOutdated: stats.scriptHash !== scriptHash(project.script ?? '', s.voiceId ?? '', s.speakingRate ?? 1, s.language ?? 'en'),
  };
}

/**
 * Stock-footage faceless video: needs an up-to-date voiceover and a scene plan for the current script
 * with a clip in every scene. 1 credit per started 30 s of voiceover (×2 for 4K).
 */
async function facelessQuote(project: ProjectDoc, workspaceId: Types.ObjectId) {
  const stats = project.narrationStats;
  const narration = project.narrationAssetId
    ? await Asset.findOne({ _id: project.narrationAssetId, workspaceId, deletedAt: null, status: 'ready', kind: 'narration_audio' })
    : null;
  if (!narration || !stats) throw badRequest('Generate the voiceover first.', 'NO_NARRATION');
  if (!project.scenes?.length) throw badRequest('Plan the scenes first.', 'NO_SCENES');
  if (project.scenesKey !== scenesKey(project.script ?? '')) throw conflict('The script changed since the scenes were planned. Plan the scenes again.', 'SCENES_OUTDATED');
  const missing = project.scenes.findIndex((sc) => !sc.clip?.id && !sc.assetId);
  if (missing >= 0) throw badRequest(`Scene ${missing + 1} has no clip yet. Search for one, edit its search or use your own media.`, 'SCENE_WITHOUT_CLIP');
  const ownIds = project.scenes.map((sc) => sc.assetId).filter(Boolean);
  if (ownIds.length) {
    const found = await Asset.countDocuments({ _id: { $in: ownIds }, workspaceId, deletedAt: null, status: 'ready' });
    if (found < new Set(ownIds.map(String)).size) throw badRequest('One of your scene media files was deleted. Choose it again.', 'SCENE_MEDIA_MISSING');
  }
  if (!getStockProvider()) throw new AppError(503, 'NOT_CONFIGURED', 'Stock footage is not configured on this server.');
  const s = project.settings ?? {};
  if (stats.voiceId && (await CustomVoice.exists({ workspaceId, providerVoiceId: stats.voiceId })) && !(await ownCustomVoice(workspaceId, stats.voiceId))) {
    throw new AppError(409, 'VOICE_WITHDRAWN', 'Consent for this custom voice was withdrawn, so its voiceover can’t be used in new videos. Choose another voice and generate the voiceover again.');
  }
  const ws = await Workspace.findById(workspaceId).select('plan creditBalance').lean();
  const plan = PLANS[(ws?.plan ?? 'free') as PlanId];
  const resolution = s.resolution ?? '1080p';
  const durationSec = narration.durationSec ?? stats.durationSec ?? 0;
  return {
    credits: facelessCreditCost(durationSec, resolution),
    balance: ws?.creditBalance ?? 0,
    sourceDurationSec: durationSec,
    resolution,
    resolutionAllowed: resolutionAllowed(resolution, plan.maxResolution),
    planMaxResolution: plan.maxResolution,
    narrationOutdated: stats.scriptHash !== scriptHash(project.script ?? '', s.voiceId ?? '', s.speakingRate ?? 1, s.language ?? 'en'),
    sceneCount: project.scenes.length,
  };
}

async function quote(project: ProjectDoc, workspaceId: Types.ObjectId) {
  if (project.mode === 'avatar') return avatarQuote(project, workspaceId);
  if (project.mode === 'faceless') return facelessQuote(project, workspaceId);
  if (project.mode !== 'editor') {
    throw new AppError(501, 'NOT_AVAILABLE', 'Generation for this project type is not available yet.');
  }
  if (!project.sourceAssetId) throw badRequest('Upload a video first.', 'NO_SOURCE');
  const source = await assertUsableSource(workspaceId, project.sourceAssetId.toString());
  const ws = await Workspace.findById(workspaceId).select('plan creditBalance').lean();
  const plan = PLANS[(ws?.plan ?? 'free') as PlanId];
  const resolution = project.settings?.resolution ?? '1080p';
  return {
    credits: editorCreditCost(source.durationSec ?? 0, resolution),
    balance: ws?.creditBalance ?? 0,
    sourceDurationSec: source.durationSec ?? 0,
    resolution,
    resolutionAllowed: resolutionAllowed(resolution, plan.maxResolution),
    planMaxResolution: plan.maxResolution,
  };
}

/** Cost preview shown before the user confirms. */
projectsRouter.get(
  '/:id/estimate',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.auth!;
    const project = await Project.findOne({ _id: req.params.id, workspaceId, deletedAt: null });
    if (!project) throw notFound('Project not found.');
    res.json({ data: await quote(project, workspaceId) });
  }),
);

/**
 * Starts a job for a project. Order matters for correctness:
 * 1. atomically move the project into `queued` (prevents double-submits / concurrent jobs),
 * 2. debit credits with an idempotency key bound to the new job id (refunded if the job dies),
 * 3. enqueue the job.
 */
async function startProjectJob(
  req: Request,
  project: ProjectDoc,
  opts: { type: JobType; credits: number; note: string; payload?: Record<string, unknown>; auditAction: string },
) {
  const { user, workspaceId } = req.auth!;
  const jobId = new Types.ObjectId();
  const previousStatus = project.status;
  const claimed = await Project.findOneAndUpdate(
    { _id: project._id, workspaceId, status: { $in: ['draft', 'completed', 'failed'] } },
    { $set: { status: 'queued', lastJobId: jobId, lastError: null } },
    { new: true },
  );
  if (!claimed) throw conflict('This project is already being processed.', 'PROJECT_BUSY');

  try {
    if (opts.credits > 0) await applyCreditChange({
      workspaceId,
      type: 'consume',
      amount: -opts.credits,
      idempotencyKey: `job:${jobId.toString()}`,
      note: `${opts.note}: ${project.title}`.slice(0, 300),
      reference: { kind: 'job', id: jobId.toString() },
      actorId: user._id,
    });
  } catch (err) {
    await Project.updateOne({ _id: project._id, lastJobId: jobId }, { $set: { status: previousStatus } });
    throw err;
  }

  let job;
  try {
    job = await enqueue({
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
    if (opts.credits > 0) await applyCreditChange({
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
  await audit(req, opts.auditAction, { actorId: user._id, workspaceId, metadata: { projectId: project._id.toString(), jobId: jobId.toString(), credits: opts.credits } });
  return { job: toPublicJob(job), credits: opts.credits };
}

projectsRouter.post(
  '/:id/generate',
  requireVerifiedEmail,
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.auth!;
    const project = await Project.findOne({ _id: req.params.id, workspaceId, deletedAt: null });
    if (!project) throw notFound('Project not found.');
    const q = await quote(project, workspaceId);
    if (!q.resolutionAllowed) {
      throw new AppError(403, 'PLAN_LIMIT', `Your plan exports up to ${q.planMaxResolution}. Lower the resolution or upgrade.`);
    }
    if ('narrationOutdated' in q && q.narrationOutdated) {
      throw conflict('Your script, voice, language or speed changed since the voiceover was made. Generate the voiceover again first.', 'NARRATION_OUTDATED');
    }
    const data = await startProjectJob(req, project, { type: 'render_project', credits: q.credits, note: 'Render', auditAction: 'project.generate' });
    res.status(202).json({ data });
  }),
);

/* ── Avatar Studio voiceover (step 3.1) ─────────────────────────────── */

async function narrationQuote(project: ProjectDoc, workspaceId: Types.ObjectId) {
  if (project.mode !== 'avatar' && project.mode !== 'faceless') throw badRequest('Voiceovers are part of Avatar Studio and Faceless projects.', 'WRONG_MODE');
  if (!getTtsProvider()) throw new AppError(503, 'NOT_CONFIGURED', 'AI voices are not configured on this server.');
  const characters = (project.script ?? '').trim().length;
  const ws = await Workspace.findById(workspaceId).select('creditBalance').lean();
  return {
    credits: narrationCreditCost(characters),
    balance: ws?.creditBalance ?? 0,
    characters,
    maxCharacters: MAX_NARRATION_CHARS,
  };
}

/** Cost preview for a voiceover of the saved script. */
projectsRouter.get(
  '/:id/narration/estimate',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.auth!;
    const project = await Project.findOne({ _id: req.params.id, workspaceId, deletedAt: null });
    if (!project) throw notFound('Project not found.');
    res.json({ data: await narrationQuote(project, workspaceId) });
  }),
);

/** Generates the voiceover for the saved script with the chosen voice. */
projectsRouter.post(
  '/:id/narrate',
  requireVerifiedEmail,
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.auth!;
    const project = await Project.findOne({ _id: req.params.id, workspaceId, deletedAt: null });
    if (!project) throw notFound('Project not found.');
    const q = await narrationQuote(project, workspaceId);
    if (q.characters === 0) throw badRequest('Write a script first.', 'NO_SCRIPT');
    if (q.characters > MAX_NARRATION_CHARS) throw badRequest(`Scripts can be up to ${MAX_NARRATION_CHARS} characters for one voiceover.`, 'SCRIPT_TOO_LONG');
    const voiceId = project.settings?.voiceId ?? '';
    if (!voiceId) throw badRequest('Choose a voice first.', 'NO_VOICE');
    let voices;
    try {
      voices = await listVoicesCached();
    } catch {
      throw new AppError(502, 'PROVIDER_ERROR', 'Could not reach the voice provider. Try again shortly.');
    }
    const custom = await ownCustomVoice(workspaceId, voiceId);
    const voice = custom ? { name: custom.name } : voices.find((v) => v.id === voiceId);
    if (!voice) throw badRequest('That voice is no longer available. Choose another one.', 'INVALID_VOICE');
    const data = await startProjectJob(req, project, {
      type: 'narrate_project',
      credits: q.credits,
      note: 'Voiceover',
      payload: { voiceId, voiceName: voice.name },
      auditAction: 'project.narrate',
    });
    res.status(202).json({ data });
  }),
);

const captionLineInput = z.object({
  start: z.number().min(0),
  end: z.number().positive(),
  text: z.string().trim().min(1, 'Caption text can’t be empty.').max(160),
  keyword: z.string().trim().max(60).default(''),
});

/**
 * Saves edited captions for the next render. Lines must be in order, not overlap, and fit the
 * rendered video; they are tied to the current cut so they never drift out of sync.
 */
projectsRouter.put(
  '/:id/captions',
  validate({ params: idParams, body: z.object({ lines: z.array(captionLineInput).min(1).max(1000) }).strict() }),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.auth!;
    const project = await Project.findOne({ _id: req.params.id, workspaceId, deletedAt: null });
    if (!project) throw notFound('Project not found.');
    if (project.status === 'queued' || project.status === 'processing') throw conflict('This project is being processed.', 'PROJECT_BUSY');
    if (!project.captionTimelineKey || !project.captionLines?.length) throw badRequest('Render the video with captions first, then edit them.', 'NO_CAPTIONS');
    const lines = (req.body as { lines: Array<z.infer<typeof captionLineInput>> }).lines;
    const maxEnd = (project.renderStats?.outputDurationSec ?? Infinity) + 0.5;
    lines.forEach((l, i) => {
      if (l.end <= l.start) throw badRequest(`Line ${i + 1} ends before it starts.`, 'INVALID_CAPTIONS');
      if (l.end > maxEnd) throw badRequest(`Line ${i + 1} runs past the end of the video.`, 'INVALID_CAPTIONS');
      const prev = lines[i - 1];
      if (prev && l.start < prev.end - 0.001) throw badRequest(`Line ${i + 1} overlaps the line before it.`, 'INVALID_CAPTIONS');
      if (l.keyword && !l.text.toLowerCase().includes(l.keyword.toLowerCase())) throw badRequest(`Line ${i + 1}: the highlighted word must appear in the line.`, 'INVALID_CAPTIONS');
    });
    project.set({ captionOverrides: lines, captionOverridesKey: project.captionTimelineKey });
    await project.save();
    res.json({ data: await withMedia(project) });
  }),
);

/** Discards caption edits; the next render generates captions again. */
projectsRouter.delete(
  '/:id/captions',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const project = await Project.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId, deletedAt: null });
    if (!project) throw notFound('Project not found.');
    project.set({ captionOverrides: null, captionOverridesKey: null });
    await project.save();
    res.json({ data: await withMedia(project) });
  }),
);

/** Latest job status for progress polling. */
projectsRouter.get(
  '/:id/job',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const project = await Project.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId, deletedAt: null }).select('lastJobId');
    if (!project) throw notFound('Project not found.');
    const job = project.lastJobId ? await Job.findOne({ _id: project.lastJobId, workspaceId: req.auth!.workspaceId }) : null;
    res.json({ data: job ? toPublicJob(job) : null });
  }),
);

/* ── Faceless scenes (step 4.1) ─────────────────────────────────────── */

const sceneParams = z.object({ id: idParams.shape.id, index: z.coerce.number().int().min(0).max(99) });

async function facelessProject(req: Request, id: string) {
  const project = await Project.findOne({ _id: id, workspaceId: req.auth!.workspaceId, deletedAt: null });
  if (!project) throw notFound('Project not found.');
  if (project.mode !== 'faceless') throw badRequest('Scenes are part of Faceless projects.', 'WRONG_MODE');
  return project;
}

/** Plans scenes from the saved script (background job; free). */
projectsRouter.post(
  '/:id/scenes/plan',
  requireVerifiedEmail,
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const project = await facelessProject(req, req.params.id!);
    if (!getStockProvider()) throw new AppError(503, 'NOT_CONFIGURED', 'Stock footage is not configured on this server.');
    if (!splitScenes(project.script ?? '', project.settings?.language ?? 'en').length) throw badRequest('Write a script first.', 'NO_SCRIPT');
    const data = await startProjectJob(req, project, {
      type: 'plan_scenes',
      credits: 0,
      note: 'Plan scenes',
      payload: { previousStatus: project.status },
      auditAction: 'project.plan_scenes',
    });
    res.status(202).json({ data });
  }),
);

/** Searches stock clips for one scene with the user's own words; saves the results as its candidates. */
projectsRouter.post(
  '/:id/scenes/:index/search',
  validate({ params: sceneParams, body: z.object({ query: z.string().trim().min(2).max(60) }).strict() }),
  asyncHandler(async (req, res) => {
    const project = await facelessProject(req, req.params.id!);
    if (project.status === 'queued' || project.status === 'processing') throw conflict('This project is being processed.', 'PROJECT_BUSY');
    const index = Number(req.params.index);
    const scene = project.scenes?.[index];
    if (!scene) throw notFound('Scene not found.');
    const stock = getStockProvider();
    if (!stock) throw new AppError(503, 'NOT_CONFIGURED', 'Stock footage is not configured on this server.');
    const query = String(req.body.query);
    const used = new Set((project.scenes ?? []).filter((_, i) => i !== index).map((sc) => sc.clip?.id).filter(Boolean) as string[]);
    let candidates;
    try {
      candidates = await findClips(stock, [query], { minDurationSec: Math.min(12, scene.text.split(/\s+/).length / 2.5), used, max: 6 });
    } catch {
      throw new AppError(502, 'PROVIDER_ERROR', 'Stock search failed. Try again shortly.');
    }
    project.set(`scenes.${index}.queries`, [query, ...(scene.queries ?? []).filter((q) => q !== query)].slice(0, 3));
    project.set(`scenes.${index}.candidates`, candidates);
    await project.save();
    res.json({ data: await withMedia(project), meta: { found: candidates.length } });
  }),
);

const sceneEdit = z
  .object({
    clipId: z.string().min(1).max(40).optional(),
    text: z.string().trim().min(1, 'A scene needs some narration.').max(1000).optional(),
    overlayText: z.string().trim().max(80).optional(),
    assetId: z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid asset id').nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length === 1, 'Change one thing at a time.');

/** Keeps the script and the scene-plan fingerprint in step after scenes are reordered or reworded. */
function syncScript(project: ProjectDoc) {
  const script = scriptFromScenes(project.scenes ?? []);
  project.set({ script, scenesKey: scenesKey(script) });
}

async function editableFaceless(req: Request, id: string) {
  const project = await facelessProject(req, id);
  if (project.status === 'queued' || project.status === 'processing') throw conflict('This project is being processed.', 'PROJECT_BUSY');
  if (project.scenesKey !== scenesKey(project.script ?? '')) throw conflict('The script changed since the scenes were planned. Plan the scenes again first.', 'SCENES_OUTDATED');
  return project;
}

/**
 * Edits one scene: pick a candidate clip, reword its narration (rewrites the script — the voiceover
 * then needs regenerating), set on-screen text, or use your own video/image instead of stock.
 */
projectsRouter.patch(
  '/:id/scenes/:index',
  validate({ params: sceneParams, body: sceneEdit }),
  asyncHandler(async (req, res) => {
    const project = await editableFaceless(req, req.params.id!);
    const index = Number(req.params.index);
    const scene = project.scenes?.[index];
    if (!scene) throw notFound('Scene not found.');
    const body = req.body as z.infer<typeof sceneEdit>;
    if (body.clipId !== undefined) {
      const clip = [...(scene.candidates ?? []), ...(scene.clip ? [scene.clip] : [])].find((c) => c.id === body.clipId);
      if (!clip) throw badRequest('That clip isn’t one of this scene’s options. Search again.', 'INVALID_CLIP');
      project.set(`scenes.${index}.clip`, clip);
      // Picking stock footage means the user wants stock here again.
      project.set(`scenes.${index}.assetId`, null);
      project.set(`scenes.${index}.assetType`, null);
    }
    if (body.text !== undefined) {
      project.set(`scenes.${index}.text`, body.text);
      syncScript(project);
    }
    if (body.overlayText !== undefined) project.set(`scenes.${index}.overlayText`, body.overlayText);
    if (body.assetId !== undefined) {
      if (body.assetId === null) {
        project.set(`scenes.${index}.assetId`, null);
        project.set(`scenes.${index}.assetType`, null);
      } else {
        const asset = await Asset.findOne({ _id: body.assetId, workspaceId: project.workspaceId, deletedAt: null, status: 'ready', kind: { $in: ['source_video', 'background_image'] } });
        if (!asset) throw badRequest('That file isn’t available. Upload it again.', 'INVALID_ASSET');
        project.set(`scenes.${index}.assetId`, asset._id);
        project.set(`scenes.${index}.assetType`, asset.kind === 'source_video' ? 'video' : 'image');
      }
    }
    if ((project.script ?? '').length > MAX_NARRATION_CHARS) throw badRequest(`Scripts can be up to ${MAX_NARRATION_CHARS} characters.`, 'SCRIPT_TOO_LONG');
    await project.save();
    res.json({ data: await withMedia(project) });
  }),
);

/** Splits a scene after a given word. The narration is unchanged, so the voiceover stays valid. */
projectsRouter.post(
  '/:id/scenes/:index/split',
  validate({ params: sceneParams, body: z.object({ atWord: z.number().int().min(1) }).strict() }),
  asyncHandler(async (req, res) => {
    const project = await editableFaceless(req, req.params.id!);
    const index = Number(req.params.index);
    const scene = project.scenes?.[index];
    if (!scene) throw notFound('Scene not found.');
    if ((project.scenes?.length ?? 0) >= MAX_SCENES) throw badRequest(`Videos can have up to ${MAX_SCENES} scenes.`, 'TOO_MANY_SCENES');
    let parts: [string, string];
    try {
      parts = splitSceneText(scene.text, req.body.atWord);
    } catch {
      throw badRequest('Choose a split point inside the scene.', 'INVALID_SPLIT');
    }
    const used = new Set((project.scenes ?? []).map((sc) => sc.clip?.id).filter(Boolean) as string[]);
    const candidates = (scene.candidates ?? []).map((c) => (typeof (c as { toObject?: () => unknown }).toObject === 'function' ? (c as unknown as { toObject: () => object }).toObject() : c));
    const next = candidates.find((c) => !used.has((c as { id: string }).id)) ?? null;
    const scenes = project.toObject().scenes ?? [];
    scenes.splice(index, 1, { ...scenes[index]!, text: parts[0] }, { text: parts[1], queries: scene.queries ?? [], clip: next, candidates, overlayText: '', assetId: null, assetType: null } as never);
    project.set('scenes', scenes);
    await project.save();
    res.json({ data: await withMedia(project) });
  }),
);

/** Merges a scene with the next one (keeps this scene's visual). */
projectsRouter.post(
  '/:id/scenes/:index/merge',
  validate({ params: sceneParams }),
  asyncHandler(async (req, res) => {
    const project = await editableFaceless(req, req.params.id!);
    const index = Number(req.params.index);
    const scenes = project.toObject().scenes ?? [];
    if (!scenes[index] || !scenes[index + 1]) throw badRequest('There is no next scene to merge with.', 'INVALID_MERGE');
    const merged = `${scenes[index]!.text} ${scenes[index + 1]!.text}`;
    if (merged.length > 1000) throw badRequest('That merged scene would be too long.', 'INVALID_MERGE');
    scenes.splice(index, 2, { ...scenes[index]!, text: merged });
    project.set('scenes', scenes);
    await project.save();
    res.json({ data: await withMedia(project) });
  }),
);

/** Moves a scene (its narration moves too, so the script is rewritten and the voiceover must be redone). */
projectsRouter.post(
  '/:id/scenes/move',
  validate({ params: idParams, body: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).strict() }),
  asyncHandler(async (req, res) => {
    const project = await editableFaceless(req, req.params.id!);
    const scenes = project.toObject().scenes ?? [];
    const { from, to } = req.body as { from: number; to: number };
    if (from >= scenes.length || to >= scenes.length) throw badRequest('Scene not found.', 'INVALID_MOVE');
    const [moved] = scenes.splice(from, 1);
    scenes.splice(to, 0, moved!);
    project.set('scenes', scenes);
    syncScript(project);
    await project.save();
    res.json({ data: await withMedia(project) });
  }),
);

/** Re-plans one scene's visuals with AI (new searches + candidates; picks the best unused clip). */
projectsRouter.post(
  '/:id/scenes/:index/replan',
  validate({ params: sceneParams }),
  asyncHandler(async (req, res) => {
    const project = await editableFaceless(req, req.params.id!);
    const index = Number(req.params.index);
    const scene = project.scenes?.[index];
    if (!scene) throw notFound('Scene not found.');
    const stock = getStockProvider();
    if (!stock) throw new AppError(503, 'NOT_CONFIGURED', 'Stock footage is not configured on this server.');
    const llm = getLLMProvider();
    let queries = [fallbackQuery(scene.text) || 'abstract background'];
    let plannedWith: 'ai' | 'keywords' = 'keywords';
    if (llm) {
      try {
        // Ask for fresh ideas, steering away from the searches already tried.
        [queries] = (await planSceneQueries(llm, [{ text: scene.text }], { language: project.settings?.language ?? 'en', topic: [project.topic, scene.queries?.length ? `avoid repeating: ${scene.queries.join(', ')}` : ''].filter(Boolean).join(' — ') })) as [string[]];
        plannedWith = 'ai';
      } catch (err) {
        logger.warn({ err }, 'Scene re-plan AI failed; using keywords');
      }
    }
    const used = new Set((project.scenes ?? []).filter((_, i) => i !== index).map((sc) => sc.clip?.id).filter(Boolean) as string[]);
    let candidates;
    try {
      candidates = await findClips(stock, queries, { minDurationSec: Math.min(12, scene.text.split(/\s+/).length / 2.5), used, max: 6 });
    } catch {
      throw new AppError(502, 'PROVIDER_ERROR', 'Stock search failed. Try again shortly.');
    }
    project.set(`scenes.${index}.queries`, queries);
    project.set(`scenes.${index}.candidates`, candidates);
    const best = candidates.find((c) => !used.has(c.id));
    if (best) project.set(`scenes.${index}.clip`, best);
    await project.save();
    res.json({ data: await withMedia(project), meta: { found: candidates.length, plannedWith } });
  }),
);
