import { Router } from 'express';
import { env } from '../../config/env.js';
import { PLANS, PLAN_IDS } from '../../config/plans.js';
import { dbState } from '../../config/db.js';
import { getTranscriptionProvider } from '../../services/ai/transcription.js';
import { getLLMProvider } from '../../services/ai/llm.js';
import { getStockProvider } from '../../services/ai/stock.js';
import { loadLibrary } from '../../services/ai/music.js';
import { getTtsProvider } from '../../services/ai/tts.js';
import { getAvatarProvider } from '../../services/ai/avatar.js';
import { getPaymentProvider } from '../../services/payments/razorpay.js';

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
        // Avatar Studio voiceovers (step 3.1): live when a text-to-speech key is configured.
        voices: Boolean(getTtsProvider()),
        scriptWriting: Boolean(getLLMProvider()),
        // B-roll for voiceover videos (no transcription needed: the voice provider gives word timings).
        stockBroll: Boolean(getLLMProvider()) && Boolean(getStockProvider()),
        // Talking-avatar video needs an avatar provider (step 3.4).
        avatarStudio: Boolean(getAvatarProvider()),
        // Faceless videos: Motion Explainer needs nothing extra; the stock style needs a stock provider.
        facelessCreator: true,
        stockFootage: Boolean(getStockProvider()),
        motionExplainer: true,
        // Razorpay checkout, subscriptions and GST invoices (Phase 5): live when keys are configured.
        payments: Boolean(getPaymentProvider()),
      },
      uploads: { maxBytes: env.uploads.maxBytes, maxSourceDurationSec: env.uploads.maxSourceDurationSec, storage: env.storage.driver },
    },
  });
});

/** Readiness: 200 only when the database is connected (load balancers route traffic on this). */
metaRouter.get('/health', (_req, res) => {
  const db = dbState();
  res.status(db === 'connected' ? 200 : 503).json({ status: db === 'connected' ? 'ok' : 'degraded', db, version: env.appVersion, uptimeSec: Math.round(process.uptime()) });
});

/** Liveness: the process is up and serving (container restarts key on this, not on the database). */
metaRouter.get('/health/live', (_req, res) => {
  res.json({ status: 'ok' });
});
