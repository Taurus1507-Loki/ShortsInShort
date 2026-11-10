import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
import { probe, runFfmpeg } from '../video/ffmpeg.js';
import { alignmentToWords, getTtsProvider, listVoicesCached, splitScript, TtsError, type TimedWord } from '../ai/tts.js';
import { ownCustomVoice } from '../voice/consent.js';

export interface NarrationPayload {
  projectId: string;
  credits: number;
  voiceId: string;
  voiceName: string;
}

export const scriptHash = (script: string, voiceId: string, rate: number, language: string) =>
  createHash('sha1').update(`${voiceId}|${rate}|${language}|${script.trim()}`).digest('hex');

/**
 * Voiceover: script → TTS (chunked at sentence boundaries, with neighbouring text for natural flow)
 * → concatenated and loudness-normalised MP3 → stored as a `narration_audio` asset, with word timings
 * saved on the project for captions.
 */
async function run({ job, signal, progress }: JobContext) {
  const payload = job.payload as NarrationPayload;
  const project = await Project.findOne({ _id: payload.projectId, workspaceId: job.workspaceId, deletedAt: null });
  if (!project) throw new PermanentJobError('The project no longer exists.');
  const script = (project.script ?? '').trim();
  if (!script) throw new PermanentJobError('The script is empty.');
  const provider = getTtsProvider();
  if (!provider) throw new PermanentJobError('Voice generation is not configured.');
  // Re-check at run time: a custom voice's consent may have been withdrawn since it was queued.
  const library = await listVoicesCached().catch(() => null);
  const allowed = (await ownCustomVoice(job.workspaceId as Types.ObjectId, payload.voiceId)) || (library ? library.some((v) => v.id === payload.voiceId) : true);
  if (!allowed) throw new PermanentJobError('That voice is no longer available (consent may have been withdrawn).');

  await Project.updateOne({ _id: project._id }, { $set: { status: 'processing', lastError: null } });
  const workDir = await mkdtemp(path.join(tmpdir(), `sis-tts-${job._id.toString()}-`));
  const ws = job.workspaceId as Types.ObjectId;
  const language = project.settings?.language ?? 'en';
  const rate = project.settings?.speakingRate ?? 1;

  try {
    const chunks = splitScript(script);
    const words: TimedWord[] = [];
    const parts: string[] = [];
    let offset = 0;
    let timingsAvailable = true;
    let model = '';
    for (let i = 0; i < chunks.length; i++) {
      await progress(5 + Math.round((i / chunks.length) * 75), 'generating voice');
      let result;
      try {
        result = await provider.synthesize(chunks[i]!, {
          voiceId: payload.voiceId,
          language,
          speed: rate,
          previousText: chunks[i - 1],
          nextText: chunks[i + 1],
          signal,
        });
      } catch (err) {
        if (err instanceof TtsError && err.permanent) throw new PermanentJobError(err.message);
        throw err;
      }
      model = result.model;
      const file = path.join(workDir, `part-${i}.mp3`);
      await writeFile(file, result.audio);
      const info = await probe(file, { signal });
      if (!info.audio || !(info.durationSec > 0)) throw new Error('The voice provider returned unreadable audio.');
      if (result.alignment) words.push(...alignmentToWords(result.alignment, offset));
      else timingsAvailable = false;
      parts.push(file);
      offset += info.durationSec;
    }

    // Join parts and normalise loudness (−16 LUFS: voice sits well under or over music later).
    await progress(85, 'finishing audio');
    const listFile = path.join(workDir, 'parts.txt');
    await writeFile(listFile, parts.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    const outFile = path.join(workDir, 'narration.mp3');
    await runFfmpeg(
      ['-f', 'concat', '-safe', '0', '-i', listFile, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', outFile],
      { signal },
    );
    const out = await probe(outFile, { signal });
    if (!out.audio || Math.abs(out.durationSec - offset) > Math.max(1, offset * 0.05)) {
      throw new Error('The finished voiceover failed validation.');
    }

    await progress(95, 'saving');
    const assetId = new Types.ObjectId();
    const key = keys.narration(ws.toString(), assetId.toString());
    await storage.uploadFile(key, outFile, 'audio/mpeg');
    const baseName = project.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'voiceover';
    await registerGeneratedAsset({
      id: assetId,
      workspaceId: ws,
      projectId: project._id,
      kind: 'narration_audio',
      storageKey: key,
      mimeType: 'audio/mpeg',
      sizeBytes: (await stat(outFile)).size,
      originalName: `${baseName} - voiceover.mp3`,
      durationSec: Math.round(out.durationSec * 1000) / 1000,
      hasAudio: true,
    });

    const stats = {
      durationSec: Math.round(out.durationSec * 10) / 10,
      characters: script.length,
      chunks: chunks.length,
      wordCount: words.length,
      timingsAvailable: timingsAvailable && words.length > 0,
      voiceId: payload.voiceId,
      voiceName: payload.voiceName,
      provider: provider.name,
      model,
      language,
      creditsCharged: payload.credits,
      scriptHash: scriptHash(script, payload.voiceId, rate, language),
      createdAt: new Date(),
    };
    const previous = project.narrationAssetId;
    await Project.updateOne(
      { _id: project._id },
      { $set: { status: 'completed', narrationAssetId: assetId, narrationWords: words, narrationStats: stats, lastError: null } },
    );
    if (previous && !previous.equals(assetId)) {
      const prev = await Asset.findOne({ _id: previous, deletedAt: null });
      if (prev) await purgeAsset(prev).catch((err) => logger.warn({ err }, 'Failed to purge previous voiceover'));
    }
    return { narrationAssetId: assetId.toString(), ...stats };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Final failure: mark the project failed and refund the credits exactly once. */
async function onDead(job: JobDoc) {
  const { projectId, credits } = job.payload as NarrationPayload;
  const msg = job.lastError ?? '';
  const friendly = /quota|API key|no longer exists|no longer available|refused|couldn't read|not configured|script is empty/i.test(msg)
    ? `${msg} Your credits were refunded.`
    : 'Voice generation failed. Your credits were refunded — please try again.';
  await Project.updateOne({ _id: projectId, lastJobId: job._id }, { $set: { status: 'failed', lastError: friendly.slice(0, 500) } });
  if (credits > 0) {
    await applyCreditChange({
      workspaceId: job.workspaceId as Types.ObjectId,
      type: 'refund',
      amount: credits,
      idempotencyKey: `refund:${job._id.toString()}`,
      note: 'Refund for failed voiceover',
      reference: { kind: 'job', id: job._id.toString() },
    });
  }
}

export function registerNarrationJob() {
  registerHandler('narrate_project', { run, onDead });
}
