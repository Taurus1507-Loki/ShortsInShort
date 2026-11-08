import { Router } from 'express';
import { asyncHandler, unauthorized } from '../../utils/errors.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { forgotPasswordLimiter, loginLimiter, refreshLimiter, registerLimiter, resendVerificationLimiter, resetPasswordLimiter, verifyEmailLimiter } from '../../middleware/security.js';
import { User, toPublicUser } from '../../models/User.js';
import { Workspace } from '../../models/Workspace.js';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  createSession,
  revokeSessionByToken,
  rotateSession,
  signAccessToken,
} from '../../services/session.service.js';
import { audit } from '../../services/audit.service.js';
import * as auth from './auth.service.js';
import { emailOnlySchema, loginSchema, registerSchema, resetPasswordSchema, tokenSchema } from './auth.schemas.js';
import { googleCallback, startGoogle } from './google.js';
import { PLANS, type PlanId } from '../../config/plans.js';

export const authRouter = Router();

authRouter.post(
  '/register',
  registerLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const user = await auth.register(req, req.body);
    const { accessToken } = await createSession(req, res, user, 'password');
    res.status(201).json({ data: { user: toPublicUser(user), accessToken } });
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const user = await auth.authenticate(req, req.body.email, req.body.password);
    const { accessToken } = await createSession(req, res, user, 'password');
    res.json({ data: { user: toPublicUser(user), accessToken } });
  }),
);

authRouter.post(
  '/refresh',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) throw unauthorized('Not signed in.', 'NO_SESSION');
    const session = await rotateSession(req, res, token);
    const user = await User.findById(session.userId).select('+passwordHash');
    if (!user || user.status !== 'active') {
      session.revokedAt = new Date();
      await session.save();
      clearRefreshCookie(res);
      throw unauthorized('Not signed in.', 'NO_SESSION');
    }
    res.json({ data: { user: toPublicUser(user), accessToken: signAccessToken(user, session._id.toString()) } });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (token) await revokeSessionByToken(token);
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { user, workspaceId } = req.auth!;
    const ws = await Workspace.findById(workspaceId).lean();
    const plan = PLANS[(ws?.plan ?? 'free') as PlanId];
    res.json({
      data: {
        user: toPublicUser(user),
        workspace: ws && {
          id: ws._id.toString(),
          name: ws.name,
          plan: plan.id,
          planName: plan.name,
          creditBalance: ws.creditBalance,
          storageBytesUsed: ws.storageBytesUsed,
          storageBytesLimit: plan.storageBytes,
        },
      },
    });
  }),
);

authRouter.post(
  '/verify-email',
  verifyEmailLimiter,
  validate({ body: tokenSchema }),
  asyncHandler(async (req, res) => {
    const user = await auth.verifyEmail(req, req.body.token);
    res.json({ data: { verified: true, email: user.email } });
  }),
);

authRouter.post(
  '/resend-verification',
  requireAuth,
  resendVerificationLimiter,
  asyncHandler(async (req, res) => {
    const { user } = req.auth!;
    if (!user.emailVerifiedAt) {
      await auth.sendVerificationEmail(user);
      await audit(req, 'auth.verification_resent', { actorId: user._id });
    }
    res.json({ data: { sent: !user.emailVerifiedAt } });
  }),
);

authRouter.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate({ body: emailOnlySchema }),
  asyncHandler(async (req, res) => {
    await auth.requestPasswordReset(req, req.body.email);
    res.json({ data: { message: 'If an account exists for that email, a reset link is on its way.' } });
  }),
);

authRouter.post(
  '/reset-password',
  resetPasswordLimiter,
  validate({ body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    await auth.resetPassword(req, req.body.token, req.body.password);
    clearRefreshCookie(res);
    res.json({ data: { reset: true } });
  }),
);

authRouter.get('/google', asyncHandler(startGoogle));
authRouter.get('/google/callback', asyncHandler(googleCallback));
