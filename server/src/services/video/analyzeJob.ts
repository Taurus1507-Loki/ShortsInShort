import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Types } from 'mongoose';
import { Project, ownedBy } from '../../models/Project.js';
import { Asset } from '../../models/Asset.js';
import type { JobDoc } from '../../models/Job.js';
import { applyCreditChange } from '../credit.service.js';
import { storage } from '../storage/storage.js';
import { PermanentJobError } from '../queue/queue.js';
import { registerHandler, type JobContext } from '../queue/worker.js';
import { probe, runFfmpeg } from './ffmpeg.js';
import { parseSilences } from './silence.js';
import { fillerIntervals } from './transcriptMap.js';
import { initialEdit, type EditCaption, type EditDoc } from './edl.js';
import { layoutLines, STYLE_SPECS, type CaptionSize, type CaptionStyle } from './captions.js';
import { outputSize, type AspectRatio, type Resolution } from './render.js';
import { getLLMProvider } from '../ai/llm.js';
import { aiKeywords } from '../ai/creative.js';
import { logger } from '../../config/logger.js';
import type { ProjectDoc } from '../../models/Project.js';
import type { Word } from '../ai/transcription.js';
import { loadTranscript } from './renderJob.js';
import { autoEdit } from './autoEdit.js';
import { getStockProvider } from '../ai/stock.js';

/**
 * AI Video Editor analysis: transcribes the footage (cached per source) and finds every pause of
 * 0.3 s or longer and every filler word. The web editor builds its timeline from this; nothing is
 * cut here — the user decides on the timeline.
 */
/**
 * Caption lines for the timeline, on SOURCE time: laid out for the project's caption style and size,
 * with AI-picked highlight words when AI is available. Filler words are left out.
 */
export async function buildEditCaptions(project: ProjectDoc, words: Word[], signal?: AbortSignal): Promise<EditCaption[]> {
  const s = project.settings ?? {};
  const style = (s.captionStyle ?? 'bold_pop') as CaptionStyle;
  const size = outputSize(project.aspectRatio as AspectRatio, (s.resolution ?? '1080p') as Resolution);
  let lines = layoutLines({ words: words.filter((w) => !w.filler), style, width: size.width, height: size.height, size: (s.captionSize ?? 'medium') as CaptionSize });
  const llm = getLLMProvider();
  if (llm && STYLE_SPECS[style].highlight && lines.length) {
    // AI picks the highlight words, but never holds the user up: after 12 s the rule-based picks stay.
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort(new Error('AI keywords took too long')), AI_KEYWORDS_TIMEOUT_MS);
    const onAbort = () => limit.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      lines = await aiKeywords(llm, lines, s.language ?? 'en', limit.signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      logger.warn({ err }, 'AI keywords failed or were slow; using rule-based highlights');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  return lines.map((l) => ({ words: l.words.map((w) => ({ text: w.text, start: w.start, end: w.end })), keyword: l.keywords[0] ?? -1 }));
}

/** Longest the highlight-word AI may take before rule-based highlights are used. */
export const AI_KEYWORDS_TIMEOUT_MS = 12_000;

interface AnalyzePayload {
  projectId: string;
  credits: number;
  previousStatus: string;
  /** Auto edit: after analysing, build the whole edit (hook, B-roll, zooms, music, sound effects). */
  auto?: { pace: 'natural' | 'fast' } | null;
}

async function run({ job, signal, progress }: JobContext) {
  const { projectId, previousStatus, auto } = job.payload as AnalyzePayload;
  const project = await Project.findOne({ _id: projectId, workspaceId: job.workspaceId, deletedAt: null });
  if (!project) throw new PermanentJobError('The project no longer exists.');
  if (!project.sourceAssetId) throw new PermanentJobError('Upload a video first.');
  const source = await Asset.findOne({ _id: project.sourceAssetId, workspaceId: job.workspaceId, deletedAt: null, status: 'ready' });
  if (!source) throw new PermanentJobError('The source video is missing or was deleted.');
  await Project.updateOne(ownedBy(project._id, job._id), { $set: { status: 'processing', lastError: null } });

  const workDir = await mkdtemp(path.join(tmpdir(), 'sis-analyze-'));
  try {
    await progress(5, 'analyzing');
    const input = await storage.getProcessingInput(source.storageKey);
    const info = await probe(input, { signal });
    if (!info.video) throw new PermanentJobError('The source file has no video track.');
    const duration = info.durationSec;

    await progress(15, 'transcribing');
    const language = project.settings?.language ?? 'en';
    const transcript = await loadTranscript(source, input, language, workDir, signal);

    await progress(70, 'finding_pauses');
    let silences: Array<{ start: number; end: number }> = [];
    if (info.audio) {
      const { stderr } = await runFfmpeg(['-i', input, '-vn', '-sn', '-dn', '-af', 'silencedetect=noise=-35dB:d=0.3', '-f', 'null', '-'], {
        signal,
        timeoutMs: Math.max(120_000, duration * 4000),
      });
      silences = parseSilences(stderr, duration);
    }
    const fillers = transcript.words ? fillerIntervals(transcript.words) : [];
    let edit: EditDoc = initialEdit(source._id.toString(), duration, silences, fillers, (project.edit as EditDoc | null) ?? null);
    if (!edit.captions && transcript.words?.length) {
      await progress(85, 'styling_captions');
      edit.captions = await buildEditCaptions(project, transcript.words, signal);
    }

    if (auto) {
      await progress(88, 'auto_editing');
      edit = await autoEdit({
        edit,
        words: transcript.words ?? [],
        language,
        style: project.style,
        projectId: project._id.toString(),
        pace: auto.pace,
        color: project.settings?.highlightColor ?? '#7C3AED',
        llm: getLLMProvider(),
        stock: getStockProvider(),
        signal,
      });
    }

    await progress(95, 'saving');
    if (signal.aborted) throw new Error('Processing was cancelled.');
    await Project.updateOne(ownedBy(project._id, job._id), {
      $set: { edit, status: previousStatus === 'completed' ? 'completed' : 'draft', lastError: transcript.error ? `Speech wasn’t transcribed: ${transcript.error}` : null },
    });
    return { silences: silences.length, fillers: fillers.length, words: transcript.words?.length ?? 0, auto: edit.auto && auto ? edit.auto.counts : null };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function onDead(job: JobDoc) {
  const { projectId, credits, previousStatus } = job.payload as AnalyzePayload;
  await Project.updateOne(
    { _id: projectId, lastJobId: job._id },
    { $set: { status: previousStatus === 'completed' ? 'completed' : 'draft', lastError: 'Analysing the video failed. Your credits were refunded — please try again.' } },
  );
  if (credits > 0) {
    await applyCreditChange({
      workspaceId: job.workspaceId as Types.ObjectId,
      type: 'refund',
      amount: credits,
      idempotencyKey: `refund:${job._id.toString()}`,
      note: 'Refund for failed video analysis',
      reference: { kind: 'job', id: job._id.toString() },
    });
  }
}

export function registerAnalyzeJob() {
  registerHandler('analyze_project', { run, onDead });
}
