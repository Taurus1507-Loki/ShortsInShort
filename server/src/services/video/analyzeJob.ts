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
import { initialEdit, type EditDoc } from './edl.js';
import { loadTranscript } from './renderJob.js';

/**
 * AI Video Editor analysis: transcribes the footage (cached per source) and finds every pause of
 * 0.3 s or longer and every filler word. The web editor builds its timeline from this; nothing is
 * cut here — the user decides on the timeline.
 */
interface AnalyzePayload {
  projectId: string;
  credits: number;
  previousStatus: string;
}

async function run({ job, signal, progress }: JobContext) {
  const { projectId, previousStatus } = job.payload as AnalyzePayload;
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
    const edit: EditDoc = initialEdit(source._id.toString(), duration, silences, fillers, (project.edit as EditDoc | null) ?? null);

    await progress(95, 'saving');
    if (signal.aborted) throw new Error('Processing was cancelled.');
    await Project.updateOne(ownedBy(project._id, job._id), {
      $set: { edit, status: previousStatus === 'completed' ? 'completed' : 'draft', lastError: transcript.error ? `Speech wasn’t transcribed: ${transcript.error}` : null },
    });
    return { silences: silences.length, fillers: fillers.length, words: transcript.words?.length ?? 0 };
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
