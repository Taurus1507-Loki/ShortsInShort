import 'dotenv/config';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  /** Public URL of the web app (used in emails and OAuth redirects). */
  APP_URL: z.url().default('http://localhost:5173'),
  /** Extra comma-separated origins allowed by CORS (APP_URL is always allowed). */
  CORS_ORIGINS: z.string().default(''),
  /** Number of reverse proxies in front of the API (for correct client IPs). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: z.enum(['true', 'false', '1', '0']).optional(),

  REQUIRE_EMAIL_VERIFICATION: bool(true),
  FREE_PLAN_CREDITS: z.coerce.number().int().min(0).default(3),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('ShortsInShort <no-reply@localhost>'),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.url().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}
const e = parsed.data;

const isProd = e.NODE_ENV === 'production';
const smtpConfigured = Boolean(e.SMTP_HOST);
const googleConfigured = Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);

if (isProd && !smtpConfigured) {
  console.error('SMTP_HOST must be configured in production (verification and reset emails).');
  process.exit(1);
}

export const env = {
  nodeEnv: e.NODE_ENV,
  isProd,
  isTest: e.NODE_ENV === 'test',
  port: e.PORT,
  logLevel: e.NODE_ENV === 'test' ? 'silent' : e.LOG_LEVEL,
  mongodbUri: e.MONGODB_URI,
  appUrl: e.APP_URL.replace(/\/$/, ''),
  corsOrigins: [
    e.APP_URL.replace(/\/$/, ''),
    ...e.CORS_ORIGINS.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  ],
  trustProxy: e.TRUST_PROXY,
  jwt: {
    accessSecret: e.JWT_ACCESS_SECRET,
    accessTtlSec: e.ACCESS_TOKEN_TTL_MIN * 60,
    issuer: 'shortsinshort-api',
    audience: 'shortsinshort-web',
  },
  refreshTtlMs: e.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' || e.COOKIE_SECURE === '1' : isProd,
  requireEmailVerification: e.REQUIRE_EMAIL_VERIFICATION,
  freePlanCredits: e.FREE_PLAN_CREDITS,
  smtp: smtpConfigured
    ? {
        host: e.SMTP_HOST!,
        port: e.SMTP_PORT,
        secure: e.SMTP_SECURE,
        user: e.SMTP_USER,
        pass: e.SMTP_PASS,
      }
    : null,
  emailFrom: e.EMAIL_FROM,
  google: googleConfigured
    ? {
        clientId: e.GOOGLE_CLIENT_ID!,
        clientSecret: e.GOOGLE_CLIENT_SECRET!,
        redirectUri: e.GOOGLE_REDIRECT_URI ?? `${e.APP_URL.replace(/\/$/, '')}/api/auth/google/callback`,
      }
    : null,
} as const;
