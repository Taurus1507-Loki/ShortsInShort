import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { Asset } from '../../models/Asset.js';
import { ConsentRecord, type ConsentDoc } from '../../models/ConsentRecord.js';
import { CustomVoice } from '../../models/CustomVoice.js';
import { purgeAsset } from '../asset.service.js';
import { storage } from '../storage/storage.js';
import { runFfmpeg } from '../video/ffmpeg.js';
import { getTranscriptionProvider, TranscriptionError } from '../ai/transcription.js';
import { getTtsProvider } from '../ai/tts.js';
import { audit } from '../audit.service.js';
import { AppError, badRequest } from '../../utils/errors.js';

/** Share of the statement's words that must be heard in the recording. */
export const STATEMENT_MATCH_THRESHOLD = 0.7;

/** The exact sentence the person must say, naming themselves and the workspace. */
export function consentStatement(subjectName: string, workspaceName: string): string {
  const name = subjectName.replace(/\s+/g, ' ').trim();
  const ws = workspaceName.replace(/\s+/g, ' ').trim();
  return `I, ${name}, agree that ShortsInShort may create an AI copy of my voice for the ${ws} workspace. I understand I can withdraw this consent at any time.`;
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * Fraction (0–1) of the statement's words heard in the transcript. Order-insensitive so small
 * recognition slips don't fail an honest recording; each heard word counts once.
 */
export function statementMatchScore(statement: string, transcript: string): number {
  const want = tokens(statement);
  if (!want.length) return 0;
  const heard = new Map<string, number>();
  for (const t of tokens(transcript)) heard.set(t, (heard.get(t) ?? 0) + 1);
  let hit = 0;
  for (const w of want) {
    const n = heard.get(w) ?? 0;
    if (n > 0) {
      hit++;
      heard.set(w, n - 1);
    }
  }
  return Math.round((hit / want.length) * 1000) / 1000;
}

/**
 * Transcribes the consent recording and checks it says the statement. Requires a speech-to-text
 * provider: without one consent cannot be verified, so cloning is unavailable (no unchecked bypass).
 */
export async function verifyStatementRecording(assetId: Types.ObjectId, statement: string): Promise<{ transcript: string; score: number }> {
  const provider = getTranscriptionProvider();
  if (!provider) throw new AppError(503, 'NOT_CONFIGURED', 'Consent recordings can’t be checked because speech-to-text is not configured on this server.');
  const asset = await Asset.findById(assetId);
  if (!asset) throw badRequest('The consent recording is missing. Record it again.', 'INVALID_ASSET');
  const dir = await mkdtemp(path.join(tmpdir(), 'sis-consent-'));
  try {
    const mp3 = path.join(dir, 'statement.mp3');
    await runFfmpeg(['-i', await storage.getProcessingInput(asset.storageKey), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', mp3]);
    let words;
    try {
      ({ words } = await provider.transcribe(mp3, { language: 'en' }));
    } catch (err) {
      logger.warn({ err }, 'Consent transcription failed');
      throw new AppError(502, 'PROVIDER_ERROR', err instanceof TranscriptionError ? `We couldn’t check the consent recording: ${err.message}` : 'We couldn’t check the consent recording. Try again shortly.');
    }
    const transcript = words.map((w) => w.text).join(' ').slice(0, 2000);
    return { transcript, score: statementMatchScore(statement, transcript) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Withdraws consent: deletes the provider clone, the voice samples and the consent recording, and
 * marks the voice revoked. The consent record itself is kept (who, when, how) as evidence.
 * Idempotent.
 */
export async function revokeConsent(consent: ConsentDoc, by: 'subject' | 'workspace', meta: { actorId?: Types.ObjectId | null } = {}) {
  if (consent.status !== 'revoked') {
    consent.set({ status: 'revoked', revokedAt: new Date(), revokedBy: by, confirmTokenHash: null, confirmExpiresAt: null });
    await consent.save();
  }
  const voices = await CustomVoice.find({ consentRecordId: consent._id });
  const provider = getTtsProvider();
  for (const v of voices) {
    if (v.providerVoiceId && provider) {
      await provider.deleteVoice(v.providerVoiceId).catch((err) => logger.error({ err, voiceId: v._id.toString() }, 'Provider voice delete failed — remove it manually'));
    }
    for (const id of v.sampleAssetIds) {
      const a = await Asset.findOne({ _id: id, deletedAt: null });
      if (a) await purgeAsset(a).catch((err) => logger.warn({ err }, 'Sample purge failed'));
    }
    v.set({ status: 'revoked', deletedAt: v.deletedAt ?? new Date(), sampleAssetIds: [] });
    await v.save();
  }
  if (consent.statementAssetId) {
    const a = await Asset.findOne({ _id: consent.statementAssetId, deletedAt: null });
    if (a) await purgeAsset(a).catch((err) => logger.warn({ err }, 'Consent recording purge failed'));
  }
  await audit(null, 'consent.revoked', {
    actorId: meta.actorId ?? null,
    workspaceId: consent.workspaceId as Types.ObjectId,
    metadata: { consentId: consent._id.toString(), by },
  });
}

/** Re-checks at use time that a voice id is usable by this workspace (premade library or its own ready clone). */
export async function ownCustomVoice(workspaceId: Types.ObjectId, providerVoiceId: string) {
  const voice = await CustomVoice.findOne({ workspaceId, providerVoiceId, status: 'ready', deletedAt: null });
  if (!voice) return null;
  const consent = await ConsentRecord.findOne({ _id: voice.consentRecordId, status: 'active' });
  return consent ? voice : null;
}
