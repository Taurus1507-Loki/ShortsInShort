import { Router } from 'express';
import { env } from '../../config/env.js';
import { PLANS, PLAN_IDS } from '../../config/plans.js';
import { dbState } from '../../config/db.js';
import { getTranscriptionProvider } from '../../services/ai/transcription.js';
import { getLLMProvider } from '../../services/ai/llm.js';
import { getStockProvider } from '../../services/ai/stock.js';
import { loadLibrary } from '../../services/ai/music.js';

export const metaRouter = Router();

/** Public configuration the web app needs before sign-in. Contains no secrets. */
metaRouter.get('/meta', (_req, res) => {
  res.json({
    data: {
      currency: 'INR',
      plans: PLAN_IDS.map((id) => PLANS[id]),
      auth: { google: Boolean(env.google), emailVerificationRequired: env.requireEmailVerification },
      emailDelivery: env.smtp ? 'smtp' : 'dev-log',
      features: {
        // Flip to true only when the module is implemented and verified.
        videoRendering: true, // upload → silence removal → reframe → render (Phase 2, step 1)
        // Live only when a speech-to-text provider key is configured.
        transcription: Boolean(getTranscriptionProvider()),
        captions: Boolean(getTranscriptionProvider()),
        // AI features: each is live only when its provider keys are configured.
        aiKeywords: Boolean(getLLMProvider()) && Boolean(getTranscriptionProvider()),
        translation: Boolean(getLLMProvider()) && Boolean(getTranscriptionProvider()),
        broll: Boolean(getLLMProvider()) && Boolean(getStockProvider()) && Boolean(getTranscriptionProvider()),
        // True only when a licensed library with at least one valid track is configured.
        music: loadLibrary().length > 0,
        zooms: true,
        brandKit: true,
        avatarStudio: false,
        facelessCreator: false,
        payments: false,
      },
      uploads: { maxBytes: env.uploads.maxBytes, maxSourceDurationSec: env.uploads.maxSourceDurationSec, storage: env.storage.driver },
    },
  });
});

metaRouter.get('/health', (_req, res) => {
  const db = dbState();
  res.status(db === 'connected' ? 200 : 503).json({ status: db === 'connected' ? 'ok' : 'degraded', db, uptimeSec: Math.round(process.uptime()) });
});
