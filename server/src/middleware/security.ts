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

const limiter = (windowMs: number, limit: number, keyByEmail = false) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.isTest && process.env.RATE_LIMIT_TESTS !== '1',
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip ?? 'unknown'); // groups IPv6 by /56 so users can't rotate addresses
      const email = keyByEmail && typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
      return `${ip}|${email}`;
    },
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } }),
  });

// In-memory stores for Phase 1 (single instance). Phase 2 switches to a Redis store so limits
// hold across horizontally scaled API instances.
export const loginLimiter = limiter(15 * 60_000, 10, true);
export const registerLimiter = limiter(60 * 60_000, 10);
export const emailActionLimiter = limiter(15 * 60_000, 5, true);
export const refreshLimiter = limiter(60_000, 30);
export const apiLimiter = limiter(60_000, 300);
