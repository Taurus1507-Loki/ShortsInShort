import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { Project } from '../../models/Project.js';
import { Asset } from '../../models/Asset.js';
import type { JobDoc } from '../../models/Job.js';
import { applyCreditChange } from '../credit.service.js';
import { purgeAsset, registerGeneratedAsset } from '../asset.service.js';
import { keys, storage } from '../storage/storage.js';
import { PermanentJobError } from '../queue/queue.js';
import { registerHandler, type JobContext } from '../queue/worker.js';
import { FfmpegError, probe } from './ffmpeg.js';
import { computeKeepSegments, detectSilences, SILENCE_PRESETS, totalDuration, type Intensity } from './silence.js';
import { extractThumbnail, outputSize, renderVideo, type AspectRatio, type Resolution } from './render.js';

export interface RenderPayload {
  projectId: string;
  credits: number;
}

/** Features configured on the project that this pipeline version does not apply yet. */
function pendingFeatureWarnings(settings: { captionsEnabled?: boolean; musicMood?: string; bRollIntensity?: string }) {
  const w: string[] = [];
  if (settings.captionsEnabled) w.push('Captions were not added: transcription is not enabled on this server yet.');
  if (settings.musicMood && settings.musicMood !== 'none') w.push('Background music was not added: no licensed music library is configured yet.');
  w.push('B-roll was not added: stock media search is not enabled on this server yet.');
  return w;
}

async function run({ job, signal, progress }: JobContext) {
  const { projectId } = job.payload as RenderPayload;
  const project = await Project.findOne({ _id: projectId, workspaceId: job.workspaceId, deletedAt: null });
  if (!project) throw new PermanentJobError('The project no longer exists.');
  if (!project.sourceAssetId) throw new PermanentJobError('The project has no source video.');
  const source = await Asset.findOne({ _id: project.sourceAssetId, workspaceId: job.workspaceId, deletedAt: null, status: 'ready' });
  if (!source) throw new PermanentJobError('The source video is missing or was deleted.');

  await Project.updateOne({ _id: project._id }, { $set: { status: 'processing', lastError: null } });
  const workDir = await mkdtemp(path.join(tmpdir(), `sis-${job._id.toString()}-`));
  const ws = job.workspaceId as Types.ObjectId;

  try {
    // 1. Analyse
    await progress(3, 'analyzing');
    const input = await storage.getProcessingInput(source.storageKey);
    const info = await probe(input, { signal });
    if (!info.video) throw new PermanentJobError('The source file has no video track.');
    const duration = info.durationSec;

    // 2. Silence & pause removal
    const intensity = (project.settings?.editingIntensity ?? 'medium') as Intensity;
    let segments = [{ start: 0, end: duration }];
    if (info.audio) {
      await progress(8, 'removing_silence');
      const silences = await detectSilences(input, duration, intensity, { signal, timeoutMs: Math.max(120_000, duration * 4000) });
      segments = computeKeepSegments(duration, silences, { padSec: SILENCE_PRESETS[intensity].padSec });
    }
    const keptSec = totalDuration(segments);

    // 3. Render (cut + reframe + loudness) — the long step, 15% → 88%
    await progress(15, 'rendering');
    const aspect = project.aspectRatio as AspectRatio;
    const resolution = (project.settings?.resolution ?? '1080p') as Resolution;
    const outFile = path.join(workDir, 'output.mp4');
    let lastReported = 15;
    await renderVideo(
      { input, output: outFile, segments, sourceDurationSec: duration, hasAudio: Boolean(info.audio), aspect, resolution },
      {
        signal,
        timeoutMs: Math.max(5 * 60_000, keptSec * 20_000),
        onFraction: (f) => {
          const pct = 15 + f * 73;
          if (pct - lastReported >= 3) {
            lastReported = pct;
            void progress(pct, 'rendering');
          }
        },
      },
    );

    // 4. Quality checks on the actual output
    await progress(90, 'finalizing');
    const out = await probe(outFile, { signal });
    const expected = outputSize(aspect, resolution);
    if (!out.video || out.video.width !== expected.width || out.video.height !== expected.height) {
      throw new Error('Rendered video failed validation (unexpected dimensions).');
    }
    if (Math.abs(out.durationSec - keptSec) > Math.max(1.5, keptSec * 0.05)) {
      throw new Error(`Rendered video failed validation (duration ${out.durationSec.toFixed(1)}s, expected ${keptSec.toFixed(1)}s).`);
    }
    const thumbFile = path.join(workDir, 'thumb.jpg');
    await extractThumbnail(outFile, thumbFile, Math.min(out.durationSec / 3, 3), { signal });

    // 5. Store outputs
    await progress(95, 'saving');
    const renderId = new Types.ObjectId();
    const thumbId = new Types.ObjectId();
    const renderKey = keys.render(ws.toString(), renderId.toString());
    const thumbKey = keys.thumbnail(ws.toString(), thumbId.toString());
    await storage.uploadFile(renderKey, outFile, 'video/mp4');
    await storage.uploadFile(thumbKey, thumbFile, 'image/jpeg');
    const baseName = project.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'video';
    await registerGeneratedAsset({
      id: thumbId,
      workspaceId: ws,
      projectId: project._id,
      kind: 'thumbnail',
      storageKey: thumbKey,
      mimeType: 'image/jpeg',
      sizeBytes: (await stat(thumbFile)).size,
      originalName: `${baseName}.jpg`,
    });
    await registerGeneratedAsset({
      id: renderId,
      workspaceId: ws,
      projectId: project._id,
      kind: 'render',
      storageKey: renderKey,
      mimeType: 'video/mp4',
      sizeBytes: (await stat(outFile)).size,
      originalName: `${baseName}.mp4`,
      durationSec: Math.round(out.durationSec * 1000) / 1000,
      width: out.video.width,
      height: out.video.height,
      hasAudio: Boolean(out.audio),
      thumbnailAssetId: thumbId,
    });

    // Replace the previous render (its storage is freed).
    const previousOutput = project.outputAssetId;
    const stats = {
      sourceDurationSec: Math.round(duration * 10) / 10,
      outputDurationSec: Math.round(out.durationSec * 10) / 10,
      silenceRemovedSec: Math.round((duration - keptSec) * 10) / 10,
      cuts: Math.max(0, segments.length - 1),
      creditsCharged: (job.payload as RenderPayload).credits,
      warnings: pendingFeatureWarnings(project.settings ?? {}),
    };
    await Project.updateOne(
      { _id: project._id },
      { $set: { status: 'completed', outputAssetId: renderId, lastRenderedAt: new Date(), lastError: null, renderStats: stats } },
    );
    if (previousOutput && !previousOutput.equals(renderId)) {
      const prev = await Asset.findOne({ _id: previousOutput, deletedAt: null });
      if (prev) await purgeAsset(prev).catch((err) => logger.warn({ err }, 'Failed to purge previous render'));
    }
    return { outputAssetId: renderId.toString(), ...stats };
  } catch (err) {
    // Inputs FFmpeg cannot decode won't succeed on retry.
    if (err instanceof FfmpegError && /Invalid data found|moov atom not found|could not find codec/i.test(err.stderrTail)) {
      throw new PermanentJobError('The source video could not be decoded.');
    }
    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Final failure: mark the project failed and refund the reserved credits exactly once. */
async function onDead(job: JobDoc) {
  const { projectId, credits } = job.payload as RenderPayload;
  await Project.updateOne(
    { _id: projectId, lastJobId: job._id },
    { $set: { status: 'failed', lastError: friendlyError(job.lastError) } },
  );
  if (credits > 0) {
    await applyCreditChange({
      workspaceId: job.workspaceId as Types.ObjectId,
      type: 'refund',
      amount: credits,
      idempotencyKey: `refund:${job._id.toString()}`,
      note: 'Refund for failed render',
      reference: { kind: 'job', id: job._id.toString() },
    });
  }
}

function friendlyError(raw: string | null | undefined): string {
  const msg = raw ?? '';
  if (/decod|no video track|missing or was deleted|no longer exists|no source video/i.test(msg)) return msg;
  if (/timed out/i.test(msg)) return 'Processing took too long and was stopped. Your credits were refunded.';
  return 'Processing failed. Your credits were refunded — please try again.';
}

export function registerRenderJob() {
  registerHandler('render_project', { run, onDead });
}
