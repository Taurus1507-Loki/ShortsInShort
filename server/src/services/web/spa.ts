import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express, { type Router } from 'express';
import helmet from 'helmet';

/** sha256 CSP sources for every inline <script> in the page (the pre-paint theme snippet). */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    out.push(`'sha256-${createHash('sha256').update(m[1]!, 'utf8').digest('base64')}'`);
  }
  return out;
}

/** Origins that signed media URLs point at (object storage), for media-src / connect-src. */
export function storageOrigins(s3: { endpoint?: string; region: string; bucket: string; forcePathStyle: boolean } | null): string[] {
  if (!s3) return [];
  if (s3.endpoint) {
    const u = new URL(s3.endpoint);
    return s3.forcePathStyle ? [u.origin] : [u.origin, `${u.protocol}//${s3.bucket}.${u.host}`];
  }
  return [`https://${s3.bucket}.s3.${s3.region}.amazonaws.com`, `https://s3.${s3.region}.amazonaws.com`];
}

/** Content Security Policy for the web app: only our own code plus Razorpay Checkout and Google Fonts. */
export function spaCsp(html: string, mediaOrigins: string[] = []) {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", ...inlineScriptHashes(html), 'https://checkout.razorpay.com'],
    // React/Radix/Remotion set style attributes at runtime.
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
    // Stock thumbnails (Pixabay CDN) and signed media URLs from object storage.
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    // data: = the Remotion preview player's built-in silent audio clip (unlocks autoplay).
    mediaSrc: ["'self'", 'blob:', 'data:', ...mediaOrigins],
    connectSrc: ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com', ...mediaOrigins],
    frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
    workerSrc: ["'self'", 'blob:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'", 'https://accounts.google.com'],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: [],
  };
}

/**
 * Serves the built web app (client/dist) from the API process: one origin, so auth cookies stay
 * first-party and no CORS is needed. Hashed assets are cached for a year; index.html never is.
 * Anything under /api is left to the API routes.
 */
export function spaRouter(dir: string, opts: { mediaOrigins?: string[] } = {}): Router {
  const indexPath = path.join(dir, 'index.html');
  if (!existsSync(indexPath)) throw new Error(`CLIENT_DIST_DIR has no index.html: ${dir}`);
  const html = readFileSync(indexPath, 'utf8');
  const router = express.Router();
  const isApi = (p: string) => p === '/api' || p.startsWith('/api/');

  const headers = helmet({
    contentSecurityPolicy: { useDefaults: false, directives: spaCsp(html, opts.mediaOrigins) },
    crossOriginEmbedderPolicy: false,
    // Razorpay Checkout opens its own window for UPI/netbanking flows.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  });
  router.use((req, res, next) => (isApi(req.path) ? next('router') : headers(req, res, next)));
  router.use(
    express.static(dir, {
      index: false,
      setHeaders: (res, file) => {
        const rel = path.relative(dir, file).replace(/\\/g, '/');
        res.setHeader('Cache-Control', rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      },
    }),
  );
  router.get(/.*/, (req, res, next) => {
    if (isApi(req.path) || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  });
  return router;
}
