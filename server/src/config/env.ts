import 'dotenv/config';
import path from 'node:path';
import { createHash } from 'node:crypto';
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

  // ── Media storage ──
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  /** HMAC key for local signed URLs. Derived from JWT_ACCESS_SECRET if unset. */
  STORAGE_SIGNING_SECRET: z.string().min(32).optional(),
  S3_ENDPOINT: z.url().optional(), // e.g. https://<account>.r2.cloudflarestorage.com
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(false),

  // ── Uploads ──
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(10_000).default(500),
  MAX_SOURCE_DURATION_SEC: z.coerce.number().int().min(10).default(900),

  // ── Video processing ──
  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),
  /** embedded = the API process also runs a worker (dev); off = run `npm run worker` separately. */
  WORKER_MODE: z.enum(['embedded', 'off']).optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  JOB_TIMEOUT_MIN: z.coerce.number().int().min(1).max(240).default(30),

  // ── AI providers ──
  DEEPGRAM_API_KEY: z.string().optional(),
  DEEPGRAM_MODEL: z.string().default('nova-3'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  /** Gemini 3 thinking level for our structured JSON tasks ('' = model default). Low keeps them fast. */
  GEMINI_THINKING_LEVEL: z.enum(['', 'minimal', 'low', 'medium', 'high']).default('low'),
  PIXABAY_API_KEY: z.string().optional(),
  /** Text-to-speech provider: sarvam (default when its key is set) or elevenlabs. */
  TTS_PROVIDER: z.enum(['auto', 'sarvam', 'elevenlabs']).default('auto'),
  /** Sarvam AI (Bulbul) — Indian-language voices. */
  SARVAM_API_KEY: z.string().optional(),
  SARVAM_TTS_MODEL: z.string().default('bulbul:v3'),
  /** Text-to-speech (Avatar Studio voiceovers). */
  ELEVENLABS_API_KEY: z.string().optional(),
  /** Model for English/Hindi/Tamil (multilingual v2 covers these). */
  ELEVENLABS_MODEL: z.string().default('eleven_multilingual_v2'),
  /** Model for languages multilingual v2 lacks (Telugu, Marathi). */
  ELEVENLABS_MODEL_INDIC: z.string().default('eleven_v3'),
  /** Talking-avatar presenters (Avatar Studio step 3.4). */
  HEYGEN_API_KEY: z.string().optional(),
  /** Motion Explainer (Remotion): entry file, optional prebuilt bundle, render concurrency. */
  MOTION_ENTRY: z.string().optional(),
  MOTION_BUNDLE_DIR: z.string().optional(),
  MOTION_CONCURRENCY: z.coerce.number().int().min(1).max(16).optional(),
  /** Folder with licensed music + music.json manifest (see services/ai/music.ts). */
  MUSIC_LIBRARY_DIR: z.string().optional(),
  /** Directory of TTF/OTF fonts for burned-in captions (defaults to the OS font folder). */
  CAPTION_FONTS_DIR: z.string().optional(),
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

if (e.STORAGE_DRIVER === 's3' && !(e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY)) {
  console.error('STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.');
  process.exit(1);
}

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
  storage: {
    driver: e.STORAGE_DRIVER,
    localDir: path.resolve(e.STORAGE_LOCAL_DIR),
    signingSecret: e.STORAGE_SIGNING_SECRET ?? createHash('sha256').update(`storage:${e.JWT_ACCESS_SECRET}`).digest('hex'),
    s3:
      e.STORAGE_DRIVER === 's3'
        ? {
            endpoint: e.S3_ENDPOINT,
            region: e.S3_REGION,
            bucket: e.S3_BUCKET!,
            accessKeyId: e.S3_ACCESS_KEY_ID!,
            secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
            forcePathStyle: e.S3_FORCE_PATH_STYLE,
          }
        : null,
  },
  uploads: {
    maxBytes: e.MAX_UPLOAD_MB * 1024 * 1024,
    maxSourceDurationSec: e.MAX_SOURCE_DURATION_SEC,
  },
  video: {
    ffmpegPath: e.FFMPEG_PATH,
    ffprobePath: e.FFPROBE_PATH,
    workerMode: e.WORKER_MODE ?? (isProd ? 'off' : e.NODE_ENV === 'test' ? 'off' : 'embedded'),
    workerConcurrency: e.WORKER_CONCURRENCY,
    jobTimeoutMs: e.JOB_TIMEOUT_MIN * 60_000,
  },
  ai: {
    deepgram: e.DEEPGRAM_API_KEY ? { apiKey: e.DEEPGRAM_API_KEY, model: e.DEEPGRAM_MODEL } : null,
    gemini: e.GEMINI_API_KEY ? { apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL, thinkingLevel: e.GEMINI_THINKING_LEVEL || null } : null,
    pixabay: e.PIXABAY_API_KEY ? { apiKey: e.PIXABAY_API_KEY } : null,
    heygen: e.HEYGEN_API_KEY ? { apiKey: e.HEYGEN_API_KEY } : null,
    ttsProvider: e.TTS_PROVIDER,
    sarvam: e.SARVAM_API_KEY ? { apiKey: e.SARVAM_API_KEY, model: e.SARVAM_TTS_MODEL } : null,
    elevenlabs: e.ELEVENLABS_API_KEY ? { apiKey: e.ELEVENLABS_API_KEY, model: e.ELEVENLABS_MODEL, indicModel: e.ELEVENLABS_MODEL_INDIC } : null,
  },
  music: {
    libraryDir: e.MUSIC_LIBRARY_DIR ? path.resolve(e.MUSIC_LIBRARY_DIR) : null,
  },
  motion: {
    entry: e.MOTION_ENTRY ? path.resolve(e.MOTION_ENTRY) : null,
    bundleDir: e.MOTION_BUNDLE_DIR ?? null,
    concurrency: e.MOTION_CONCURRENCY ?? null,
  },
  captions: {
    fontsDir: path.resolve(e.CAPTION_FONTS_DIR ?? (process.platform === 'win32' ? 'C:/Windows/Fonts' : '/usr/share/fonts')),
  },
} as const;
