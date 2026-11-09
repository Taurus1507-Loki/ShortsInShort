import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
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
import { extractSpeechAudio, extractThumbnail, outputSize, renderVideo, resolveFraming, type AspectRatio, type Resolution } from './render.js';
import { env } from '../../config/env.js';
import { Transcript } from '../../models/Transcript.js';
import { getTranscriptionProvider, TranscriptionError, type Word } from '../ai/transcription.js';
import { fillerIntervals, mergeIntervals, remapWords } from './transcriptMap.js';
import { buildAss, type CaptionPosition, type CaptionSize, type CaptionStyle } from './captions.js';
import type { AssetDoc } from '../../models/Asset.js';

export interface RenderPayload {
  projectId: string;
  credits: number;
}

/** Translated captions need a translation provider (Phase 2.3); say so instead of pretending. */
function captionLanguageWarning(settings: { language?: string; captionLanguage?: string }, captionsAdded: boolean): string[] {
  const target = settings.captionLanguage ?? 'same';
  if (!captionsAdded || target === 'same' || target === (settings.language ?? 'en')) return [];
  return ['Captions are shown in the spoken language: caption translation is not enabled on this server yet.'];
}

/** Honest notes about requested features that were not applied to this render. */
function pendingFeatureWarnings(
  settings: { captionsEnabled?: boolean; musicMood?: string; bRollIntensity?: string },
  captions: { added: boolean; error: string | null; providerConfigured: boolean; hasAudio: boolean },
) {
  const w: string[] = [];
  if (settings.captionsEnabled && !captions.added) {
    if (!captions.hasAudio) w.push('Captions were not added: the video has no audio track.');
    else if (!captions.providerConfigured) w.push('Captions were not added: transcription is not enabled on this server yet.');
    else if (captions.error) w.push(`Captions were not added: ${captions.error}`);
    else w.push('Captions were not added: no speech was detected.');
  }
  if (settings.musicMood && settings.musicMood !== 'none') w.push('Background music was not added: no licensed music library is configured yet.');
  w.push('B-roll was not added: stock media search is not enabled on this server yet.');
  return w;
}

/**
 * Word-level transcript for the source, reused from cache when available so re-renders never pay
 * for transcription twice. Failures are non-fatal: the render continues without captions.
 */
async function loadTranscript(
  source: AssetDoc,
  input: string,
  language: string,
  workDir: string,
  signal: AbortSignal,
): Promise<{ words: Word[] | null; error: string | null }> {
  const provider = getTranscriptionProvider();
  if (!provider) return { words: null, error: null };
  const cached = await Transcript.findOne({ assetId: source._id, provider: provider.name, language }).lean();
  if (cached) return { words: cached.words as Word[], error: null };
  try {
    const audio = path.join(workDir, 'speech.mp3');
    await extractSpeechAudio(input, audio, { signal });
    const result = await provider.transcribe(audio, { language, signal });
    await Transcript.updateOne(
      { assetId: source._id, provider: provider.name, language },
      { $set: { workspaceId: source.workspaceId, words: result.words, durationSec: source.durationSec } },
      { upsert: true },
    );
    return { words: result.words, error: null };
  } catch (err) {
    if (signal.aborted) throw err;
    logger.warn({ err, assetId: source._id.toString() }, 'Transcription failed; rendering without captions');
    return { words: null, error: err instanceof TranscriptionError ? err.message : 'transcription failed.' };
  }
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

    // 2. Transcription (when a provider is configured): powers captions and filler-word removal
    const settings = project.settings ?? {};
    const intensity = (settings.editingIntensity ?? 'medium') as Intensity;
    const language = settings.language ?? 'en';
    const providerConfigured = Boolean(getTranscriptionProvider());
    let transcript: { words: Word[] | null; error: string | null } = { words: null, error: null };
    if (info.audio && providerConfigured && (settings.captionsEnabled || intensity !== 'low')) {
      await progress(6, 'transcribing');
      transcript = await loadTranscript(source, input, language, workDir, signal);
    }

    // 3. Silence, pause & filler-word removal
    let segments = [{ start: 0, end: duration }];
    let fillerWordsRemoved = 0;
    if (info.audio) {
      await progress(12, 'removing_silence');
      const silences = await detectSilences(input, duration, intensity, { signal, timeoutMs: Math.max(120_000, duration * 4000) });
      const fillers = transcript.words && intensity !== 'low' ? fillerIntervals(transcript.words) : [];
      fillerWordsRemoved = fillers.length;
      segments = computeKeepSegments(duration, mergeIntervals([...silences, ...fillers]), { padSec: SILENCE_PRESETS[intensity].padSec });
    }
    const keptSec = totalDuration(segments);

    // 4. Captions, timed to the edited timeline
    const aspectForCaptions = project.aspectRatio as AspectRatio;
    const size = outputSize(aspectForCaptions, (settings.resolution ?? '1080p') as Resolution);
    let captions: { assPath: string; fontsDir: string } | undefined;
    if (settings.captionsEnabled && transcript.words?.length) {
      const words = remapWords(transcript.words, segments);
      if (words.length) {
        const { ass } = buildAss({
          words,
          style: (settings.captionStyle ?? 'bold_pop') as CaptionStyle,
          position: (settings.captionPosition ?? 'bottom') as CaptionPosition,
          highlightColor: settings.highlightColor ?? '#A78BFA',
          size: (settings.captionSize ?? 'medium') as CaptionSize,
          width: size.width,
          height: size.height,
          language,
        });
        const assPath = path.join(workDir, 'captions.ass');
        await writeFile(assPath, ass, 'utf8');
        captions = { assPath, fontsDir: env.captions.fontsDir };
      }
    }

    // 5. Render (cut + reframe + captions + loudness) — the long step, 15% → 88%
    await progress(15, 'rendering');
    const aspect = project.aspectRatio as AspectRatio;
    const resolution = (project.settings?.resolution ?? '1080p') as Resolution;
    const framing = resolveFraming((settings.framing ?? 'auto') as 'auto' | 'crop' | 'blur', info.video, aspect);
    const outFile = path.join(workDir, 'output.mp4');
    let lastReported = 15;
    await renderVideo(
      { input, output: outFile, segments, sourceDurationSec: duration, hasAudio: Boolean(info.audio), aspect, resolution, captions, framing },
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
      captionsAdded: Boolean(captions),
      fillerWordsRemoved,
      framing,
      warnings: [
        ...captionLanguageWarning(settings, Boolean(captions)),
        ...pendingFeatureWarnings(settings, {
        added: Boolean(captions),
        error: transcript.error,
        providerConfigured,
        hasAudio: Boolean(info.audio),
        }),
      ],
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
