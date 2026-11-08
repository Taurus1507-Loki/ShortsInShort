import type { Request } from 'express';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { User, type UserDoc } from '../../models/User.js';
import { Workspace } from '../../models/Workspace.js';
import { AuthToken, type AuthTokenType } from '../../models/AuthToken.js';
import { getDummyHash, hashPassword, randomToken, sha256, verifyPassword } from '../../utils/crypto.js';
import { AppError, badRequest, conflict, unauthorized } from '../../utils/errors.js';
import { emails, sendEmail } from '../../services/email.service.js';
import { applyCreditChange } from '../../services/credit.service.js';
import { audit } from '../../services/audit.service.js';
import { revokeAllSessions } from '../../services/session.service.js';

const TOKEN_TTL: Record<AuthTokenType, number> = {
  email_verify: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
};

/** Creates a user with a personal workspace. */
export async function createUserWithWorkspace(input: {
  email: string;
  fullName: string;
  passwordHash: string | null;
  googleId?: string;
  emailVerified?: boolean;
  avatarUrl?: string | null;
}): Promise<UserDoc> {
  const userId = new Types.ObjectId();
  const workspace = await Workspace.create({
    name: `${input.fullName.split(' ')[0]}'s workspace`,
    ownerId: userId,
    members: [{ userId, role: 'owner' }],
  });
  try {
    return await User.create({
      _id: userId,
      email: input.email,
      fullName: input.fullName,
      passwordHash: input.passwordHash,
      googleId: input.googleId,
      avatarUrl: input.avatarUrl ?? null,
      emailVerifiedAt: input.emailVerified ? new Date() : null,
      defaultWorkspaceId: workspace._id,
    });
  } catch (err) {
    await Workspace.deleteOne({ _id: workspace._id });
    if ((err as { code?: number }).code === 11000) throw conflict('An account with this email already exists.', 'EMAIL_TAKEN');
    throw err;
  }
}

export async function issueAuthToken(userId: Types.ObjectId, type: AuthTokenType): Promise<string> {
  // Invalidate earlier unused tokens of the same type so only the newest link works.
  await AuthToken.updateMany({ userId, type, usedAt: null }, { usedAt: new Date() });
  const token = randomToken(32);
  await AuthToken.create({ userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_TTL[type]) });
  return token;
}

/** Atomically marks a token used and returns its user id (single use). */
export async function consumeAuthToken(token: string, type: AuthTokenType): Promise<Types.ObjectId> {
  const doc = await AuthToken.findOneAndUpdate(
    { tokenHash: sha256(token), type, usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
  );
  if (!doc) throw badRequest('This link is invalid or has expired. Please request a new one.', 'INVALID_TOKEN');
  return doc.userId as Types.ObjectId;
}

export async function sendVerificationEmail(user: UserDoc) {
  const token = await issueAuthToken(user._id, 'email_verify');
  await sendEmail(emails.verify(user.email, user.fullName, `${env.appUrl}/verify-email?token=${token}`));
}

/** Free-plan starter credits are granted once, on verification (not signup) to limit abuse. */
export async function grantSignupCredits(user: UserDoc) {
  if (env.freePlanCredits <= 0) return;
  await applyCreditChange({
    workspaceId: user.defaultWorkspaceId,
    type: 'grant',
    amount: env.freePlanCredits,
    idempotencyKey: `signup-grant:${user._id.toString()}`,
    note: 'Free plan starter credits',
  });
}

export async function register(req: Request, input: { fullName: string; email: string; password: string }) {
  const user = await createUserWithWorkspace({
    email: input.email,
    fullName: input.fullName,
    passwordHash: await hashPassword(input.password),
  });
  await audit(req, 'auth.register', { actorId: user._id, workspaceId: user.defaultWorkspaceId });
  if (env.requireEmailVerification) {
    await sendVerificationEmail(user);
  } else {
    user.emailVerifiedAt = new Date();
    await user.save();
    await grantSignupCredits(user);
  }
  return user;
}

export async function authenticate(req: Request, email: string, password: string): Promise<UserDoc> {
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !user.passwordHash) {
    await verifyPassword(await getDummyHash(), password); // constant-time-ish: don't reveal which emails exist
    await audit(req, 'auth.login_failed', { metadata: { reason: 'unknown_or_no_password' } });
    throw unauthorized('Incorrect email or password.', 'INVALID_CREDENTIALS');
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    await audit(req, 'auth.login_failed', { actorId: user._id, metadata: { reason: 'bad_password' } });
    throw unauthorized('Incorrect email or password.', 'INVALID_CREDENTIALS');
  }
  if (user.status !== 'active') throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is not active. Contact support.');
  user.lastLoginAt = new Date();
  await user.save();
  await audit(req, 'auth.login', { actorId: user._id, workspaceId: user.defaultWorkspaceId });
  return user;
}

export async function verifyEmail(req: Request, token: string) {
  const userId = await consumeAuthToken(token, 'email_verify');
  const user = await User.findById(userId);
  if (!user || user.status !== 'active') throw badRequest('This link is invalid or has expired.', 'INVALID_TOKEN');
  if (!user.emailVerifiedAt) {
    user.emailVerifiedAt = new Date();
    await user.save();
    await grantSignupCredits(user);
    await sendEmail(emails.welcome(user.email, user.fullName));
    await audit(req, 'auth.email_verified', { actorId: user._id });
  }
  return user;
}

export async function requestPasswordReset(req: Request, email: string) {
  const user = await User.findOne({ email, status: 'active' });
  // Always respond identically whether or not the account exists.
  if (!user) return;
  const token = await issueAuthToken(user._id, 'password_reset');
  await sendEmail(emails.passwordReset(user.email, user.fullName, `${env.appUrl}/reset-password?token=${token}`));
  await audit(req, 'auth.password_reset_requested', { actorId: user._id });
}

export async function resetPassword(req: Request, token: string, password: string) {
  const userId = await consumeAuthToken(token, 'password_reset');
  const user = await User.findById(userId);
  if (!user || user.status !== 'active') throw badRequest('This link is invalid or has expired.', 'INVALID_TOKEN');
  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  // Completing a reset proves control of the inbox.
  if (!user.emailVerifiedAt) {
    user.emailVerifiedAt = new Date();
    await grantSignupCredits(user);
  }
  await user.save();
  await revokeAllSessions(user._id);
  await sendEmail(emails.passwordChanged(user.email, user.fullName));
  await audit(req, 'auth.password_reset', { actorId: user._id });
}
