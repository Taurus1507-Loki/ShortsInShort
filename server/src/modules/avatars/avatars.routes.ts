import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth, requireVerifiedEmail } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, AppError, badRequest, conflict, notFound } from '../../utils/errors.js';
import { env } from '../../config/env.js';
import { PLANS, type PlanId } from '../../config/plans.js';
import { CREDIT_COSTS } from '../../config/credits.js';
import { Asset } from '../../models/Asset.js';
import { Workspace } from '../../models/Workspace.js';
import { ConsentRecord, toPublicConsent } from '../../models/ConsentRecord.js';
import { PhotoAvatar, toPublicPhotoAvatar } from '../../models/PhotoAvatar.js';
import { getAvatarProvider } from '../../services/ai/avatar.js';
import { getTranscriptionProvider } from '../../services/ai/transcription.js';
import { consentStatement, revokeConsent, STATEMENT_MATCH_THRESHOLD, verifyStatementRecording } from '../../services/voice/consent.js';
import { startPhotoAvatar } from '../../services/avatar/photoAvatarJob.js';
import { audit } from '../../services/audit.service.js';
import { emails, sendEmail } from '../../services/email.service.js';
import { randomToken, sha256 } from '../../utils/crypto.js';

/**
 * Personal branding: a talking avatar made from one photo of a real person. Uses the same consent
 * rules as cloned voices — the person says a consent statement (checked by speech-to-text); someone
 * else's face also needs their confirmation by email; withdrawing consent deletes the photo and the
 * avatar at the provider.
 */
export const avatarsRouter = Router();
avatarsRouter.use(requireAuth);

const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid id');

const notConfiguredAvatars = () => new AppError(503, 'NOT_CONFIGURED', 'Talking avatars are not configured on this server.');

/** What photo avatars need on this server, the price and the workspace's allowance. */
avatarsRouter.get(
  '/photo/status',
  asyncHandler(async (req, res) => {
    const ws = await Workspace.findById(req.auth!.workspaceId).select('plan').lean();
    const limit = PLANS[(ws?.plan ?? 'free') as PlanId].photoAvatars;
    const used = await PhotoAvatar.countDocuments({ workspaceId: req.auth!.workspaceId, deletedAt: null, status: { $ne: 'revoked' } });
    res.json({
      data: {
        avatarsConfigured: Boolean(getAvatarProvider()),
        consentCheckConfigured: Boolean(getTranscriptionProvider()),
        limit,
        used,
        createCredits: CREDIT_COSTS.photoAvatarCreate,
        perMinuteCredits: CREDIT_COSTS.presenterPerMin,
        matchThreshold: STATEMENT_MATCH_THRESHOLD,
      },
    });
  }),
);

/** The sentence the person reads aloud (names them and this workspace). */
avatarsRouter.get(
  '/photo/statement',
  validate({ query: z.object({ subjectName: z.string().trim().min(2).max(80) }) }),
  asyncHandler(async (req, res) => {
    const ws = await Workspace.findById(req.auth!.workspaceId).select('name').lean();
    res.json({ data: { statement: consentStatement(String(req.query.subjectName), ws?.name ?? 'your', 'likeness') } });
  }),
);

avatarsRouter.get(
  '/photo',
  asyncHandler(async (req, res) => {
    const avatars = await PhotoAvatar.find({ workspaceId: req.auth!.workspaceId, deletedAt: null }).sort({ createdAt: -1 });
    const consents = await ConsentRecord.find({ _id: { $in: avatars.map((a) => a.consentRecordId) } });
    res.json({
      data: avatars.map((a) => {
        const c = consents.find((x) => x._id.equals(a.consentRecordId));
        return { ...toPublicPhotoAvatar(a), consent: c ? toPublicConsent(c) : null };
      }),
    });
  }),
);

const createSchema = z
  .object({
    name: z.string().trim().min(2, 'Name the avatar.').max(60),
    relationship: z.enum(['self', 'other']),
    subjectName: z.string().trim().min(2, 'Enter the person’s full name.').max(80),
    subjectEmail: z.email('Enter the person’s email address.').max(254).optional(),
    attestations: z
      .object({
        rightsAndConsent: z.literal(true, 'Please confirm you have the person’s consent.'),
        notPublicFigure: z.literal(true, 'Please confirm this isn’t a public figure.'),
        acceptsUsePolicy: z.literal(true, 'Please accept the avatar use rules.'),
      })
      .strict(),
    statementAssetId: objectId,
    photoAssetId: objectId,
  })
  .strict();

/**
 * Creates a photo avatar. Checks: provider + speech-to-text configured, plan allowance, credits,
 * attestations, uploads belong to this workspace, and that the consent recording says the statement.
 * Your own face: creation starts now (and is charged). Someone else's: they confirm by email first.
 */
avatarsRouter.post(
  '/photo',
  requireVerifiedEmail,
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const body = req.body as z.infer<typeof createSchema>;
    if (!getAvatarProvider()) throw notConfiguredAvatars();
    if (!getTranscriptionProvider()) throw new AppError(503, 'NOT_CONFIGURED', 'Consent recordings can’t be checked because speech-to-text is not configured on this server.');

    const ws = await Workspace.findById(workspaceId).select('plan name creditBalance').lean();
    const limit = PLANS[(ws?.plan ?? 'free') as PlanId].photoAvatars;
    const used = await PhotoAvatar.countDocuments({ workspaceId, deletedAt: null, status: { $ne: 'revoked' } });
    if (used >= limit) {
      throw new AppError(403, 'PLAN_LIMIT', limit === 0 ? 'Photo avatars are available on paid plans.' : `Your plan includes ${limit} photo avatar${limit === 1 ? '' : 's'}. Remove one or upgrade.`);
    }
    if ((ws?.creditBalance ?? 0) < CREDIT_COSTS.photoAvatarCreate) {
      throw new AppError(402, 'INSUFFICIENT_CREDITS', `Creating a photo avatar costs ${CREDIT_COSTS.photoAvatarCreate} credits.`);
    }

    const subjectEmail = body.relationship === 'self' ? user.email : body.subjectEmail?.toLowerCase();
    if (!subjectEmail) throw badRequest('Enter the email address of the person in the photo — they must confirm.', 'SUBJECT_EMAIL_REQUIRED');
    if (body.relationship === 'other' && subjectEmail === user.email.toLowerCase()) {
      throw badRequest('That’s your own email — choose “My own face” instead.', 'SUBJECT_EMAIL_IS_SELF');
    }

    const statementAsset = await Asset.findOne({ _id: body.statementAssetId, workspaceId, kind: 'consent_recording', status: 'ready', deletedAt: null });
    if (!statementAsset) throw badRequest('Record the consent statement first.', 'INVALID_ASSET');
    const photo = await Asset.findOne({ _id: body.photoAssetId, workspaceId, kind: 'avatar_photo', status: 'ready', deletedAt: null });
    if (!photo) throw badRequest('Upload the photo first.', 'INVALID_ASSET');
    if (await PhotoAvatar.exists({ photoAssetId: photo._id, deletedAt: null })) throw conflict('That photo is already used by another avatar.', 'ASSET_BUSY');

    const statement = consentStatement(body.subjectName, ws?.name ?? 'your', 'likeness');
    const check = await verifyStatementRecording(statementAsset._id, statement);
    if (check.score < STATEMENT_MATCH_THRESHOLD) {
      throw badRequest(
        `The consent recording doesn’t match the statement (we heard: “${check.transcript.slice(0, 160) || 'nothing clear'}”). Record it again, reading the statement exactly, in English.`,
        'CONSENT_NOT_MATCHED',
        { score: check.score },
      );
    }

    const self = body.relationship === 'self';
    const revokeToken = randomToken();
    const confirmToken = self ? null : randomToken();
    const consent = await ConsentRecord.create({
      workspaceId,
      createdBy: user._id,
      kind: 'likeness',
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
    const avatar = await PhotoAvatar.create({
      workspaceId,
      createdBy: user._id,
      consentRecordId: consent._id,
      name: body.name,
      photoAssetId: photo._id,
      status: 'awaiting_consent',
    });

    const revokeUrl = `${env.appUrl}/consent/withdraw?token=${revokeToken}`;
    if (self) {
      await startPhotoAvatar(avatar._id, workspaceId, user._id);
      await sendEmail(emails.consentRecorded(subjectEmail, body.subjectName, ws?.name ?? '', revokeUrl, 'likeness'));
    } else {
      await sendEmail(emails.consentRequest(subjectEmail, body.subjectName, user.fullName, ws?.name ?? '', statement, `${env.appUrl}/consent/confirm?token=${confirmToken}`, revokeUrl, 'likeness'));
    }
    await audit(req, 'consent.created', {
      actorId: user._id,
      workspaceId,
      metadata: { consentId: consent._id.toString(), photoAvatarId: avatar._id.toString(), relationship: body.relationship, match: check.score },
    });
    const fresh = await PhotoAvatar.findById(avatar._id);
    res.status(201).json({ data: { ...toPublicPhotoAvatar(fresh!), consent: toPublicConsent(consent) } });
  }),
);

/** Tries again after a failure (charged again; the earlier charge was refunded). */
avatarsRouter.post(
  '/photo/:id/retry',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const avatar = await PhotoAvatar.findOne({ _id: req.params.id, workspaceId, deletedAt: null });
    if (!avatar) throw notFound('Avatar not found.');
    if (avatar.status !== 'failed') throw conflict('Only a failed avatar can be retried.', 'NOT_FAILED');
    const consent = await ConsentRecord.findById(avatar.consentRecordId);
    if (!consent || consent.status !== 'active') throw conflict('Consent is not active for this avatar.', 'CONSENT_INACTIVE');
    if (!getAvatarProvider()) throw notConfiguredAvatars();
    await startPhotoAvatar(avatar._id, workspaceId, user._id);
    const fresh = await PhotoAvatar.findById(avatar._id);
    res.json({ data: toPublicPhotoAvatar(fresh!) });
  }),
);

/** Removes a photo avatar: withdraws consent for the workspace and deletes the photo and the avatar. */
avatarsRouter.delete(
  '/photo/:id',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const avatar = await PhotoAvatar.findOne({ _id: req.params.id, workspaceId, deletedAt: null });
    if (!avatar) throw notFound('Avatar not found.');
    const consent = await ConsentRecord.findById(avatar.consentRecordId);
    if (consent) await revokeConsent(consent, 'workspace', { actorId: user._id });
    else {
      avatar.set({ status: 'revoked', deletedAt: new Date() });
      await avatar.save();
    }
    res.status(204).end();
  }),
);
