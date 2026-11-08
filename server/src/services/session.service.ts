import type { Request, Response, CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { Session, type SessionDoc } from '../models/Session.js';
import type { UserDoc, Role } from '../models/User.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { unauthorized } from '../utils/errors.js';

export const REFRESH_COOKIE = 'sis_rt';
/** Rotated tokens presented again within this window are treated as a benign race, not theft. */
const REUSE_GRACE_MS = 15_000;

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  role: Role;
  wid: string;
}

const refreshCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: env.refreshTtlMs,
});

export function signAccessToken(user: UserDoc, sessionId: string): string {
  const claims: AccessTokenClaims = {
    sub: user._id.toString(),
    sid: sessionId,
    role: user.role as Role,
    wid: user.defaultWorkspaceId.toString(),
  };
  return jwt.sign(claims, env.jwt.accessSecret, {
    algorithm: 'HS256',
    expiresIn: env.jwt.accessTtlSec,
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, env.jwt.accessSecret, {
    algorithms: ['HS256'],
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  }) as AccessTokenClaims;
}

export async function createSession(req: Request, res: Response, user: UserDoc, method: 'password' | 'google') {
  const refreshToken = randomToken(48);
  const session = await Session.create({
    userId: user._id,
    refreshTokenHash: sha256(refreshToken),
    userAgent: req.get('user-agent')?.slice(0, 512) ?? '',
    ip: req.ip ?? '',
    method,
    expiresAt: new Date(Date.now() + env.refreshTtlMs),
  });
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return { session, accessToken: signAccessToken(user, session._id.toString()) };
}

/** Validates and rotates a refresh token. Returns the live session. */
export async function rotateSession(req: Request, res: Response, refreshToken: string): Promise<SessionDoc> {
  const hash = sha256(refreshToken);
  const now = new Date();
  const newToken = randomToken(48);

  // Atomic compare-and-swap so two concurrent refreshes can't both succeed with one token.
  const session = await Session.findOneAndUpdate(
    { refreshTokenHash: hash, revokedAt: null, expiresAt: { $gt: now } },
    {
      $set: {
        refreshTokenHash: sha256(newToken),
        previousTokenHash: hash,
        rotatedAt: now,
        lastUsedAt: now,
        ip: req.ip ?? '',
      },
    },
    { new: true },
  );

  if (!session) {
    const reused = await Session.findOne({ previousTokenHash: hash, revokedAt: null });
    if (reused && reused.rotatedAt && now.getTime() - reused.rotatedAt.getTime() > REUSE_GRACE_MS) {
      // A token that was already rotated is being replayed: assume it was stolen.
      reused.revokedAt = now;
      await reused.save();
    }
    clearRefreshCookie(res);
    throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
  }

  res.cookie(REFRESH_COOKIE, newToken, refreshCookieOptions());
  return session;
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
}

export async function revokeSessionByToken(refreshToken: string) {
  await Session.updateOne({ refreshTokenHash: sha256(refreshToken), revokedAt: null }, { revokedAt: new Date() });
}

export async function revokeAllSessions(userId: Types.ObjectId | string, exceptSessionId?: string) {
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: new Types.ObjectId(exceptSessionId) };
  await Session.updateMany(filter, { revokedAt: new Date() });
}
