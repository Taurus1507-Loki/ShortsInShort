import type { NextFunction, Request, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { forbidden } from '../utils/errors.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence in depth. The refresh cookie is SameSite=Strict and every other endpoint uses a
 * Bearer token (not sent automatically by browsers), but we additionally reject state-changing
 * requests whose Origin header is present and not on the allowlist.
 */
export function originCheck(req: Request, _res: Response, next: NextFunction) {
  if (!UNSAFE.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !env.corsOrigins.includes(origin)) return next(forbidden('Origin not allowed.', 'BAD_ORIGIN'));
  next();
}

/**
 * Each exported limiter is its own instance with its own counter, so one action (e.g. clicking
 * "Resend email") can never use up the allowance of another (e.g. opening the verification link).
 * Keys combine the client IP with the signed-in user or submitted email where relevant.
 */
const limiter = (windowMs: number, limit: number, opts: { byEmail?: boolean; byUser?: boolean } = {}) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.isTest && process.env.RATE_LIMIT_TESTS !== '1',
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip ?? 'unknown'); // groups IPv6 by /56 so users can't rotate addresses
      const email = opts.byEmail && typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
      const user = opts.byUser ? (req.auth?.user._id.toString() ?? '') : '';
      return `${ip}|${email}|${user}`;
    },
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' } }),
  });

// In-memory stores (single instance). Switch to a Redis store when the API runs on several
// servers so limits hold across instances.
const MIN = 60_000;
export const loginLimiter = limiter(15 * MIN, 10, { byEmail: true });
export const registerLimiter = limiter(60 * MIN, 10);
/** Verification tokens carry 256 bits of entropy, so this only needs to stop floods. */
export const verifyEmailLimiter = limiter(15 * MIN, 30);
/** Limits how many verification emails one account can trigger. */
export const resendVerificationLimiter = limiter(15 * MIN, 5, { byUser: true });
export const forgotPasswordLimiter = limiter(15 * MIN, 5, { byEmail: true });
export const resetPasswordLimiter = limiter(15 * MIN, 10);
/** Sensitive signed-in actions (change password, delete account): per user. */
export const sensitiveActionLimiter = limiter(15 * MIN, 10, { byUser: true });
export const refreshLimiter = limiter(MIN, 30);
export const apiLimiter = limiter(MIN, 300);
/** AI script writing (paid LLM calls). */
export const aiWriteLimiter = limiter(60 * MIN, 30, { byUser: true });
/** Razorpay webhook deliveries (generous: retries arrive in bursts). */
export const webhookLimiter = limiter(MIN, 600);
/** Generated voice samples (cached after the first request per voice + language). */
export const voiceSampleLimiter = limiter(60 * MIN, 120, { byUser: true });
/** Public consent links (confirm / withdraw / lookup). */
export const consentLimiter = limiter(15 * MIN, 30);
