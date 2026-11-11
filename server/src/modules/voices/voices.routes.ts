import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth, requireVerifiedEmail } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, AppError, badRequest, conflict, notConfigured, notFound } from '../../utils/errors.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { PLANS, type PlanId } from '../../config/plans.js';
import { Asset } from '../../models/Asset.js';
import { Workspace } from '../../models/Workspace.js';
import { User } from '../../models/User.js';
import { ConsentRecord, toPublicConsent } from '../../models/ConsentRecord.js';
import { CustomVoice, toPublicCustomVoice } from '../../models/CustomVoice.js';
import { getTtsProvider, listVoicesCached, TtsError, type VoiceInfo } from '../../services/ai/tts.js';
import { getTranscriptionProvider } from '../../services/ai/transcription.js';
import { consentStatement, revokeConsent, STATEMENT_MATCH_THRESHOLD, verifyStatementRecording } from '../../services/voice/consent.js';
import { enqueue } from '../../services/queue/queue.js';
import { audit } from '../../services/audit.service.js';
import { emails, sendEmail } from '../../services/email.service.js';
import { storage } from '../../services/storage/storage.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { keys } from '../../services/storage/storage.js';
import { voiceSampleLimiter } from '../../middleware/security.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SUPPORTED_LANGUAGES } from '../projects/projects.schemas.js';

export const voicesRouter = Router();
voicesRouter.use(requireAuth);

const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_SAMPLE_SEC = 30;
const MAX_SAMPLE_SEC = 5 * 60;

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');
const idParams = z.object({ id: objectId });

/** Library voices + this workspace's ready custom voices (custom first). */
voicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const provider = getTtsProvider();
    if (!provider) throw notConfigured('AI voices');
    let library: VoiceInfo[];
    try {
      library = await listVoicesCached();
    } catch (err) {
      logger.warn({ err }, 'Voice list failed');
      throw new AppError(502, 'PROVIDER_ERROR', err instanceof TtsError ? err.message : 'Could not load voices from the provider. Try again shortly.');
    }
    const own = await CustomVoice.find({ workspaceId: req.auth!.workspaceId, status: 'ready', deletedAt: null }).sort({ createdAt: -1 });
    const custom: VoiceInfo[] = await Promise.all(
      own.map(async (v) => {
        const sample = v.sampleAssetIds[0] ? await Asset.findOne({ _id: v.sampleAssetIds[0], deletedAt: null }) : null;
        return {
          id: v.providerVoiceId!,
          name: v.name,
          category: 'custom',
          gender: null,
          age: null,
          accent: null,
          description: v.description || 'Your consented custom voice',
          useCase: null,
          previewUrl: sample ? await storage.getDownloadUrl(sample.storageKey, { expiresSec: 3600 }) : null,
          languages: [v.language],
        };
      }),
    );
    res.json({ data: [...custom, ...library], meta: { provider: provider.name } });
  }),
);

const SAMPLE_LINES: Record<string, (name: string) => string> = {
  en: (n) => `Hi, I'm ${n}. This is how your videos will sound with my voice.`,
  hi: (n) => `नमस्ते, मैं ${n} हूँ। आपके वीडियो मेरी आवाज़ में ऐसे सुनाई देंगे।`,
  te: (n) => `నమస్కారం, నేను ${n}. మీ వీడియోలు నా గొంతులో ఇలా వినిపిస్తాయి.`,
  ta: (n) => `வணக்கம், நான் ${n}. உங்கள் வீடியோக்கள் என் குரலில் இப்படி ஒலிக்கும்.`,
  mr: (n) => `नमस्कार, मी ${n}. तुमचे व्हिडिओ माझ्या आवाजात असे ऐकू येतील.`,
};

/**
 * A short sample of a library voice in a language, for providers that host no preview clips (Sarvam).
 * Generated once per provider + voice + language and kept in storage, so listening costs almost nothing.
 */
voicesRouter.get(
  '/:id/sample',
  voiceSampleLimiter,
  validate({ params: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }), query: z.object({ language: z.enum(SUPPORTED_LANGUAGES).default('en') }) }),
  asyncHandler(async (req, res) => {
    const provider = getTtsProvider();
    if (!provider) throw notConfigured('AI voices');
    const language = String(req.query.language ?? 'en');
    const voice = (await listVoicesCached()).find((v) => v.id === req.params.id);
    if (!voice) throw notFound('Voice not found.');
    if (voice.previewUrl) {
      res.json({ data: { url: voice.previewUrl } });
      return;
    }
    const key = keys.voiceSample(provider.name, voice.id, language);
    if (!(await storage.stat(key))) {
      const dir = await mkdtemp(path.join(tmpdir(), 'sis-sample-'));
      try {
        const r = await provider.synthesize((SAMPLE_LINES[language] ?? SAMPLE_LINES.en!)(voice.name), { voiceId: voice.id, language });
        const file = path.join(dir, 'sample.mp3');
        await writeFile(file, r.audio);
        await storage.uploadFile(key, file, 'audio/mpeg');
      } catch (err) {
        logger.warn({ err, voice: voice.id }, 'Voice sample failed');
        throw new AppError(502, 'PROVIDER_ERROR', err instanceof TtsError ? err.message : 'Could not create a sample right now.');
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    res.json({ data: { url: await storage.getDownloadUrl(key, { expiresSec: 3600 }) } });
  }),
);

/* ── Custom (cloned) voices ─────────────────────────────────────────── */

/** What cloning needs on this server, and the workspace's allowance. */
voicesRouter.get(
  '/custom/status',
  asyncHandler(async (req, res) => {
    const ws = await Workspace.findById(req.auth!.workspaceId).select('plan name').lean();
    const limit = PLANS[(ws?.plan ?? 'free') as PlanId].customVoices;
    const used = await CustomVoice.countDocuments({ workspaceId: req.auth!.workspaceId, deletedAt: null, status: { $ne: 'revoked' } });
    res.json({
      data: {
        voicesConfigured: Boolean(getTtsProvider()),
        consentCheckConfigured: Boolean(getTranscriptionProvider()),
        limit,
        used,
        minSampleSec: MIN_SAMPLE_SEC,
        maxSampleSec: MAX_SAMPLE_SEC,
        matchThreshold: STATEMENT_MATCH_THRESHOLD,
      },
    });
  }),
);

/** The sentence to read aloud for a given person (names the person and this workspace). */
voicesRouter.get(
  '/custom/statement',
  validate({ query: z.object({ subjectName: z.string().trim().min(2).max(80) }) }),
  asyncHandler(async (req, res) => {
    const ws = await Workspace.findById(req.auth!.workspaceId).select('name').lean();
    res.json({ data: { statement: consentStatement(String(req.query.subjectName), ws?.name ?? 'your') } });
  }),
);

voicesRouter.get(
  '/custom',
  asyncHandler(async (req, res) => {
    const voices = await CustomVoice.find({ workspaceId: req.auth!.workspaceId, deletedAt: null }).sort({ createdAt: -1 });
    const consents = await ConsentRecord.find({ _id: { $in: voices.map((v) => v.consentRecordId) } });
    res.json({
      data: voices.map((v) => {
        const c = consents.find((x) => x._id.equals(v.consentRecordId));
        return { ...toPublicCustomVoice(v), consent: c ? toPublicConsent(c) : null };
      }),
    });
  }),
);

const createSchema = z
  .object({
    name: z.string().trim().min(2, 'Name the voice.').max(60),
    language: z.enum(SUPPORTED_LANGUAGES).default('en'),
    description: z.string().trim().max(200).default(''),
    relationship: z.enum(['self', 'other']),
    subjectName: z.string().trim().min(2, 'Enter the person’s full name.').max(80),
    subjectEmail: z.email('Enter the person’s email address.').max(254).optional(),
    attestations: z
      .object({
        rightsAndConsent: z.literal(true, 'Please confirm you have the person’s consent.'),
        notPublicFigure: z.literal(true, 'Please confirm this isn’t a public figure.'),
        acceptsUsePolicy: z.literal(true, 'Please accept the voice use rules.'),
      })
      .strict(),
    statementAssetId: objectId,
    sampleAssetIds: z.array(objectId).min(1, 'Add at least one voice sample.').max(5),
  })
  .strict();

/**
 * Creates a custom voice. Checks, in order: provider + speech-to-text configured, plan allowance,
 * attestations, recordings belong to this workspace, enough sample audio, and that the consent
 * recording actually says the statement. Self: cloning starts now. Someone else: they must confirm
 * by email first.
 */
voicesRouter.post(
  '/custom',
  requireVerifiedEmail,
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const body = req.body as z.infer<typeof createSchema>;
    if (!getTtsProvider()) throw notConfigured('AI voices');
    if (!getTranscriptionProvider()) throw new AppError(503, 'NOT_CONFIGURED', 'Consent recordings can’t be checked because speech-to-text is not configured on this server.');

    const ws = await Workspace.findById(workspaceId).select('plan name').lean();
    const limit = PLANS[(ws?.plan ?? 'free') as PlanId].customVoices;
    const used = await CustomVoice.countDocuments({ workspaceId, deletedAt: null, status: { $ne: 'revoked' } });
    if (used >= limit) {
      throw new AppError(403, 'PLAN_LIMIT', limit === 0 ? 'Custom voices are available on paid plans.' : `Your plan includes ${limit} custom voice${limit === 1 ? '' : 's'}. Remove one or upgrade.`);
    }

    const subjectEmail = body.relationship === 'self' ? user.email : body.subjectEmail?.toLowerCase();
    if (!subjectEmail) throw badRequest('Enter the email address of the person whose voice this is — they must confirm.', 'SUBJECT_EMAIL_REQUIRED');
    if (body.relationship === 'other' && subjectEmail === user.email.toLowerCase()) {
      throw badRequest('That’s your own email — choose “My own voice” instead.', 'SUBJECT_EMAIL_IS_SELF');
    }

    const statementAsset = await Asset.findOne({ _id: body.statementAssetId, workspaceId, kind: 'consent_recording', status: 'ready', deletedAt: null });
    if (!statementAsset) throw badRequest('Record the consent statement first.', 'INVALID_ASSET');
    const sampleIds = [...new Set(body.sampleAssetIds)];
    const samples = await Asset.find({ _id: { $in: sampleIds }, workspaceId, kind: 'voice_sample', status: 'ready', deletedAt: null });
    if (samples.length !== sampleIds.length) throw badRequest('One of the voice samples is missing. Upload it again.', 'INVALID_ASSET');
    const inUse = await CustomVoice.exists({ sampleAssetIds: { $in: sampleIds }, deletedAt: null });
    if (inUse) throw conflict('A sample is already used by another voice.', 'ASSET_BUSY');
    const total = samples.reduce((t, a) => t + (a.durationSec ?? 0), 0);
    if (total < MIN_SAMPLE_SEC) throw badRequest(`Add more voice samples: ${Math.round(total)} s so far, at least ${MIN_SAMPLE_SEC} s needed (1–2 minutes sounds best).`, 'SAMPLES_TOO_SHORT');
    if (total > MAX_SAMPLE_SEC) throw badRequest('Voice samples can add up to 5 minutes at most.', 'SAMPLES_TOO_LONG');

    const statement = consentStatement(body.subjectName, ws?.name ?? 'your');
    const check = await verifyStatementRecording(statementAsset._id, statement);
    if (check.score < STATEMENT_MATCH_THRESHOLD) {
      throw badRequest(
        `The consent recording doesn’t match the statement (we heard: “${check.transcript.slice(0, 160) || 'nothing clear'}”). Record it again, reading the statement exactly, in English.`,
        'CONSENT_NOT_MATCHED',
        { score: check.score },
      );
    }

    const revokeToken = randomToken();
    const confirmToken = body.relationship === 'other' ? randomToken() : null;
    const self = body.relationship === 'self';
    const consent = await ConsentRecord.create({
      workspaceId,
      createdBy: user._id,
      kind: 'voice',
      relationship: body.relationship,
      subjectName: body.subjectName,
      subjectEmail,
      statementText: statement,
      statementAssetId: statementAsset._id,
      statementTranscript: check.transcript,
      statementMatch: check.score,
      attestations: body.attestations,
      status: self ? 'active' : 'awaiting_subject',
      grantedAt: self ? new Date() : null,
      ip: req.ip ?? '',
      userAgent: req.get('user-agent')?.slice(0, 512) ?? '',
      confirmTokenHash: confirmToken ? sha256(confirmToken) : null,
      confirmExpiresAt: confirmToken ? new Date(Date.now() + CONFIRM_TTL_MS) : null,
      revokeTokenHash: sha256(revokeToken),
    });
    const voice = await CustomVoice.create({
      workspaceId,
      createdBy: user._id,
      consentRecordId: consent._id,
      name: body.name,
      language: body.language,
      description: body.description,
      sampleAssetIds: samples.map((s) => s._id),
      sampleDurationSec: Math.round(total * 10) / 10,
      status: self ? 'cloning' : 'awaiting_consent',
    });

    const revokeUrl = `${env.appUrl}/consent/withdraw?token=${revokeToken}`;
    if (self) {
      await startClone(voice._id, workspaceId);
      await sendEmail(emails.consentRecorded(subjectEmail, body.subjectName, ws?.name ?? '', revokeUrl));
    } else {
      const confirmUrl = `${env.appUrl}/consent/confirm?token=${confirmToken}`;
      await sendEmail(emails.consentRequest(subjectEmail, body.subjectName, user.fullName, ws?.name ?? '', statement, confirmUrl, revokeUrl));
    }
    await audit(req, 'consent.created', {
      actorId: user._id,
      workspaceId,
      metadata: { consentId: consent._id.toString(), voiceId: voice._id.toString(), relationship: body.relationship, match: check.score },
    });
    const fresh = await CustomVoice.findById(voice._id);
    res.status(201).json({ data: { ...toPublicCustomVoice(fresh!), consent: toPublicConsent(consent) } });
  }),
);

/** Removes a custom voice: withdraws consent on the workspace's behalf and deletes everything biometric. */
voicesRouter.delete(
  '/custom/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const voice = await CustomVoice.findOne({ _id: req.params.id, workspaceId, deletedAt: null });
    if (!voice) throw notFound('Voice not found.');
    const consent = await ConsentRecord.findById(voice.consentRecordId);
    if (consent) await revokeConsent(consent, 'workspace', { actorId: user._id });
    else {
      voice.set({ status: 'revoked', deletedAt: new Date() });
      await voice.save();
    }
    res.status(204).end();
  }),
);

export async function startClone(voiceId: Types.ObjectId, workspaceId: Types.ObjectId) {
  const jobId = new Types.ObjectId();
  await CustomVoice.updateOne({ _id: voiceId }, { $set: { status: 'cloning', lastJobId: jobId, failureReason: null } });
  await enqueue({ _id: jobId, type: 'clone_voice', workspaceId, payload: { voiceId: voiceId.toString() }, maxAttempts: 3 });
}

/* ── Public consent pages (the person whose voice it is; no account needed) ── */

export const consentRouter = Router();

const tokenBody = z.object({ token: z.string().min(20).max(100) }).strict();

async function findByToken(token: string, purpose: 'confirm' | 'withdraw') {
  const hash = sha256(token);
  const consent = await ConsentRecord.findOne(purpose === 'confirm' ? { confirmTokenHash: hash } : { revokeTokenHash: hash });
  if (!consent) throw notFound('This link is invalid or has already been used.', 'INVALID_TOKEN');
  return consent;
}

async function describe(consentId: Types.ObjectId) {
  const c = await ConsentRecord.findById(consentId);
  const voice = await CustomVoice.findOne({ consentRecordId: consentId });
  const ws = c ? await Workspace.findById(c.workspaceId).select('name').lean() : null;
  const requester = c ? await User.findById(c.createdBy).select('fullName').lean() : null;
  return {
    subjectName: c!.subjectName,
    statementText: c!.statementText,
    status: c!.status,
    relationship: c!.relationship,
    workspaceName: ws?.name ?? '',
    requesterName: requester?.fullName ?? '',
    voiceName: voice?.name ?? '',
    confirmExpiresAt: c!.confirmExpiresAt,
    revokedAt: c!.revokedAt,
  };
}

/** Details for the confirm/withdraw page (token in the body, never in a logged URL). */
consentRouter.post(
  '/lookup',
  validate({ body: tokenBody.extend({ purpose: z.enum(['confirm', 'withdraw']) }).strict() }),
  asyncHandler(async (req, res) => {
    const consent = await findByToken(req.body.token, req.body.purpose);
    res.json({ data: await describe(consent._id) });
  }),
);

/** The subject agrees: consent becomes active and cloning starts. */
consentRouter.post(
  '/confirm',
  validate({ body: tokenBody }),
  asyncHandler(async (req, res) => {
    const consent = await findByToken(req.body.token, 'confirm');
    if (consent.status !== 'awaiting_subject') throw conflict('This consent request is no longer open.', 'CONSENT_CLOSED');
    if (!consent.confirmExpiresAt || consent.confirmExpiresAt < new Date()) throw new AppError(410, 'TOKEN_EXPIRED', 'This link has expired. Ask for a new request.');
    consent.set({ status: 'active', grantedAt: new Date(), subjectConfirmedAt: new Date(), subjectConfirmIp: req.ip ?? '', confirmTokenHash: null, confirmExpiresAt: null });
    await consent.save();
    const voice = await CustomVoice.findOne({ consentRecordId: consent._id, deletedAt: null });
    if (voice) await startClone(voice._id, consent.workspaceId as Types.ObjectId);
    await audit(req, 'consent.confirmed', { workspaceId: consent.workspaceId as Types.ObjectId, metadata: { consentId: consent._id.toString() } });
    res.json({ data: await describe(consent._id) });
  }),
);

/** The subject withdraws (before or after confirming): everything biometric is deleted. */
consentRouter.post(
  '/withdraw',
  validate({ body: tokenBody }),
  asyncHandler(async (req, res) => {
    const consent = await findByToken(req.body.token, 'withdraw');
    const wasRevoked = consent.status === 'revoked';
    await revokeConsent(consent, 'subject');
    if (!wasRevoked && consent.relationship === 'other') {
      const owner = await User.findById(consent.createdBy).select('email fullName').lean();
      const voice = await CustomVoice.findOne({ consentRecordId: consent._id });
      if (owner) await sendEmail(emails.consentWithdrawn(owner.email, owner.fullName, consent.subjectName, voice?.name ?? 'custom voice'));
    }
    res.json({ data: await describe(consent._id) });
  }),
);
