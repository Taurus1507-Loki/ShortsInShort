import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { logger } from '../../config/logger.js';
import { Asset } from '../../models/Asset.js';
import { ConsentRecord } from '../../models/ConsentRecord.js';
import { CustomVoice } from '../../models/CustomVoice.js';
import type { JobDoc } from '../../models/Job.js';
import { PermanentJobError } from '../queue/queue.js';
import { registerHandler, type JobContext } from '../queue/worker.js';
import { storage } from '../storage/storage.js';
import { runFfmpeg } from '../video/ffmpeg.js';
import { getTtsProvider, TtsError } from '../ai/tts.js';

/**
 * Creates the provider voice clone from the samples — only while consent is active. Samples are
 * converted to 192 kbps MP3 (the provider's recommendation) first.
 */
async function run({ job, signal, progress }: JobContext) {
  const { voiceId } = job.payload as { voiceId: string };
  const voice = await CustomVoice.findOne({ _id: voiceId, workspaceId: job.workspaceId, deletedAt: null });
  if (!voice) throw new PermanentJobError('The voice was removed.');
  const consent = await ConsentRecord.findById(voice.consentRecordId);
  if (!consent || consent.status !== 'active') throw new PermanentJobError('Consent is not active.');
  const provider = getTtsProvider();
  if (!provider) throw new PermanentJobError('AI voices are not configured.');
  if (voice.providerVoiceId) return { providerVoiceId: voice.providerVoiceId }; // already created (retry after save)

  const dir = await mkdtemp(path.join(tmpdir(), `sis-clone-${job._id.toString()}-`));
  try {
    await progress(10, 'preparing samples');
    const files = [];
    for (const [i, id] of voice.sampleAssetIds.entries()) {
      const a = await Asset.findOne({ _id: id, deletedAt: null, status: 'ready' });
      if (!a) throw new PermanentJobError('A voice sample is missing.');
      const out = path.join(dir, `sample-${i + 1}.mp3`);
      await runFfmpeg(['-i', await storage.getProcessingInput(a.storageKey), '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '192k', out], { signal });
      files.push({ filename: `sample-${i + 1}.mp3`, data: await readFile(out), mimeType: 'audio/mpeg' });
    }

    // Providers that clone from one short reference (Sarvam: 10–15 s) get the samples joined and trimmed.
    if (provider.cloneSampleSec && files.length) {
      const list = path.join(dir, 'samples.txt');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(list, files.map((_, i) => `file '${path.join(dir, `sample-${i + 1}.mp3`).replace(/\\/g, '/')}'`).join('\n'));
      const ref = path.join(dir, 'reference.mp3');
      await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-t', String(provider.cloneSampleSec), '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '192k', ref], { signal });
      files.splice(0, files.length, { filename: 'reference.mp3', data: await readFile(ref), mimeType: 'audio/mpeg' });
    }

    await progress(50, 'creating voice');
    let providerVoiceId: string;
    try {
      providerVoiceId = await provider.cloneVoice({
        // Workspace-scoped name so voices are traceable on the shared provider account.
        name: `sis-${voice.workspaceId.toString().slice(-6)}-${voice.name}`,
        description: `ShortsInShort custom voice ${voice._id.toString()} (consent ${consent._id.toString()})`,
        language: voice.language,
        files,
        signal,
      });
    } catch (err) {
      if (err instanceof TtsError && err.permanent) throw new PermanentJobError(err.message);
      throw err;
    }

    // Consent may have been withdrawn while the provider was working: never keep that clone.
    const still = await ConsentRecord.findById(consent._id).select('status');
    const current = await CustomVoice.findById(voice._id).select('deletedAt');
    if (still?.status !== 'active' || current?.deletedAt) {
      await provider.deleteVoice(providerVoiceId).catch((err) => logger.error({ err, providerVoiceId }, 'Orphan clone delete failed — remove it manually'));
      throw new PermanentJobError('Consent was withdrawn during cloning.');
    }
    await CustomVoice.updateOne({ _id: voice._id }, { $set: { status: 'ready', provider: provider.name, providerVoiceId, failureReason: null } });
    await progress(100, 'done');
    return { providerVoiceId };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function onDead(job: JobDoc) {
  const { voiceId } = job.payload as { voiceId: string };
  const msg = job.lastError ?? '';
  await CustomVoice.updateOne(
    { _id: voiceId, lastJobId: job._id, status: 'cloning' },
    { $set: { status: 'failed', failureReason: (msg && !/HTTP 5\d\d|ECONN|fetch failed/i.test(msg) ? msg : 'Voice cloning failed. Remove the voice and try again.').slice(0, 300) } },
  );
}

export function registerCloneJob() {
  registerHandler('clone_voice', { run, onDead });
}
