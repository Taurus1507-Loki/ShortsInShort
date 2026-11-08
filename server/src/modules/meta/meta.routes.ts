import { Router } from 'express';
import { env } from '../../config/env.js';
import { PLANS, PLAN_IDS } from '../../config/plans.js';
import { dbState } from '../../config/db.js';

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
        transcription: false,
        captions: false,
        broll: false,
        music: false,
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
