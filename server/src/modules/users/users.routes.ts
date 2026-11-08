import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { emailActionLimiter } from '../../middleware/security.js';
import { asyncHandler, badRequest, notFound, unauthorized } from '../../utils/errors.js';
import { hashPassword, verifyPassword } from '../../utils/crypto.js';
import { toPublicUser } from '../../models/User.js';
import { Session } from '../../models/Session.js';
import { Project } from '../../models/Project.js';
import { Workspace } from '../../models/Workspace.js';
import { clearRefreshCookie, revokeAllSessions } from '../../services/session.service.js';
import { audit } from '../../services/audit.service.js';
import { emails, sendEmail } from '../../services/email.service.js';
import { nameSchema, passwordSchema } from '../auth/auth.schemas.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.patch(
  '/me',
  validate({ body: z.object({ fullName: nameSchema }).strict() }),
  asyncHandler(async (req, res) => {
    const { user } = req.auth!;
    user.fullName = req.body.fullName;
    await user.save();
    res.json({ data: { user: toPublicUser(user) } });
  }),
);

usersRouter.post(
  '/me/password',
  emailActionLimiter,
  validate({ body: z.object({ currentPassword: z.string().max(128).optional(), newPassword: passwordSchema }).strict() }),
  asyncHandler(async (req, res) => {
    const { user, sessionId } = req.auth!;
    // Google-only accounts may set a first password without a current one.
    if (user.passwordHash) {
      if (!req.body.currentPassword || !(await verifyPassword(user.passwordHash, req.body.currentPassword))) {
        throw badRequest('Current password is incorrect.', 'INVALID_PASSWORD');
      }
    }
    user.passwordHash = await hashPassword(req.body.newPassword);
    user.passwordChangedAt = new Date();
    await user.save();
    await revokeAllSessions(user._id, sessionId);
    await sendEmail(emails.passwordChanged(user.email, user.fullName));
    await audit(req, 'user.password_changed', { actorId: user._id });
    res.json({ data: { user: toPublicUser(user) } });
  }),
);

usersRouter.get(
  '/me/sessions',
  asyncHandler(async (req, res) => {
    const { user, sessionId } = req.auth!;
    const sessions = await Session.find({ userId: user._id, revokedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ lastUsedAt: -1 })
      .limit(50)
      .lean();
    res.json({
      data: sessions.map((s) => ({
        id: s._id.toString(),
        userAgent: s.userAgent,
        ip: s.ip,
        method: s.method,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        current: s._id.toString() === sessionId,
      })),
    });
  }),
);

usersRouter.delete(
  '/me/sessions/:id',
  validate({ params: z.object({ id: z.string().refine(Types.ObjectId.isValid, 'Invalid id') }) }),
  asyncHandler(async (req, res) => {
    const { user } = req.auth!;
    const r = await Session.updateOne({ _id: req.params.id, userId: user._id, revokedAt: null }, { revokedAt: new Date() });
    if (r.matchedCount === 0) throw notFound('Session not found.');
    await audit(req, 'user.session_revoked', { actorId: user._id, metadata: { sessionId: req.params.id } });
    res.status(204).end();
  }),
);

usersRouter.post(
  '/me/sessions/revoke-others',
  asyncHandler(async (req, res) => {
    const { user, sessionId } = req.auth!;
    await revokeAllSessions(user._id, sessionId);
    await audit(req, 'user.sessions_revoked_others', { actorId: user._id });
    res.status(204).end();
  }),
);

/**
 * Account deletion: immediately deactivates and anonymises the account, revokes all sessions and
 * soft-deletes the workspace's projects. A scheduled purge job (Phase 2, once media storage exists)
 * hard-deletes stored media and records after the retention window.
 */
usersRouter.delete(
  '/me',
  emailActionLimiter,
  validate({ body: z.object({ password: z.string().max(128).optional(), confirm: z.literal('DELETE') }).strict() }),
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    if (user.passwordHash && !(req.body.password && (await verifyPassword(user.passwordHash, req.body.password)))) {
      throw unauthorized('Password is incorrect.', 'INVALID_PASSWORD');
    }
    const now = new Date();
    const originalEmail = user.email;
    user.status = 'deleted';
    user.deletedAt = now;
    user.email = `deleted+${user._id.toString()}@deleted.invalid`;
    user.fullName = 'Deleted user';
    user.passwordHash = null;
    user.googleId = undefined;
    user.avatarUrl = null;
    await user.save();
    await revokeAllSessions(user._id);
    await Project.updateMany({ workspaceId, deletedAt: null }, { deletedAt: now });
    await Workspace.updateOne({ _id: workspaceId, ownerId: user._id }, { $set: { name: 'Deleted workspace' } });
    await audit(req, 'user.account_deleted', {
      actorId: user._id,
      workspaceId,
      metadata: { emailDomain: originalEmail.split('@')[1] },
    });
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);
