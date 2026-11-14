import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { apiLimiter, consentLimiter, originCheck } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { projectsRouter } from './modules/projects/projects.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { metaRouter } from './modules/meta/meta.routes.js';
import { assetsRouter } from './modules/assets/assets.routes.js';
import { storageRouter } from './modules/storage/storage.routes.js';
import { brandKitRouter } from './modules/brandkit/brandkit.routes.js';
import { consentRouter, voicesRouter } from './modules/voices/voices.routes.js';
import { aiRouter } from './modules/ai/ai.routes.js';
import { billingRouter, razorpayWebhook } from './modules/billing/billing.routes.js';
import { webhookLimiter } from './middleware/security.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.trustProxy > 0) app.set('trust proxy', env.trustProxy);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      // Log the essentials only. Query strings are dropped: signed storage URLs carry signatures.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, path: req.url.split('?')[0] }),
        res: (res: { statusCode: number }) => ({ status: res.statusCode }),
      },
    }),
  );
  app.use(
    helmet({
      // API returns JSON only; the SPA's CSP is set by the web server that serves it.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      maxAge: 600,
    }),
  );
  // Razorpay webhooks need the exact raw bytes for signature checks, and come without an Origin header,
  // so they are handled before the JSON parser and the origin check.
  app.post('/api/billing/webhook', webhookLimiter, express.raw({ type: '*/*', limit: '1mb' }), (req, res, next) => {
    razorpayWebhook(req, res).catch(next);
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(originCheck);

  // Signed local-storage URLs (dev/single-server). Mounted before the JSON limiter-heavy API so
  // video range requests aren't throttled; the HMAC signature is the access control.
  if (env.storage.driver === 'local') app.use('/api/storage', storageRouter);
  app.use('/api', metaRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', apiLimiter);
  app.use('/api/users', usersRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/assets', assetsRouter);
  app.use('/api/brand-kit', brandKitRouter);
  app.use('/api/voices', voicesRouter);
  app.use('/api/consent', consentLimiter, consentRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/billing', billingRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
