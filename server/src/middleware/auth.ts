import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { User, type Role } from '../models/User.js';
import { Session } from '../models/Session.js';
import { verifyAccessToken } from '../services/session.service.js';
import { env } from '../config/env.js';
import { AppError, forbidden, unauthorized } from '../utils/errors.js';

/**
 * Requires a valid Bearer access token, a live (non-revoked) session and an active user.
 * Checking the session on every request makes "sign out this device" take effect immediately
 * rather than after the access token expires. (Phase 2+: cache this lookup in Redis.)
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let claims;
    try {
      claims = verifyAccessToken(header.slice(7));
    } catch {
      throw unauthorized('Your session has expired. Please sign in again.', 'TOKEN_EXPIRED');
    }
    if (!Types.ObjectId.isValid(claims.sub) || !Types.ObjectId.isValid(claims.sid)) throw unauthorized();

    const [user, session] = await Promise.all([
      User.findById(claims.sub).select('+passwordHash'),
      Session.findOne({ _id: claims.sid, userId: claims.sub, revokedAt: null, expiresAt: { $gt: new Date() } })
        .select('_id')
        .lean(),
    ]);
    if (!user || !session) throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_EXPIRED');
    if (user.status !== 'active') throw forbidden('This account is not active.', 'ACCOUNT_INACTIVE');

    req.auth = { user, sessionId: claims.sid, workspaceId: user.defaultWorkspaceId };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction) {
  if (env.requireEmailVerification && !req.auth?.user.emailVerifiedAt) {
    return next(new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address first.'));
  }
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.user.role as Role)) return next(forbidden());
    next();
  };
