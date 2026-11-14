import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inlineScriptHashes, spaRouter, storageOrigins } from '../services/web/spa.js';

const HTML = '<!doctype html><html><head><script>var t=1;</script><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>';
let dir: string;
let app: express.Express;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sis-spa-'));
  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, 'index.html'), HTML);
  await writeFile(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  await writeFile(path.join(dir, 'favicon.svg'), '<svg/>');
  app = express();
  app.use(spaRouter(dir, { mediaOrigins: ['https://media.example.com'] }));
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  app.use((_req, res) => res.status(404).json({ error: 'nf' }));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('web app hosting', () => {
  it('serves index.html for app routes with a strict CSP and no caching', async () => {
    const r = await request(app).get('/app/projects').set('Accept', 'text/html').expect(200);
    expect(r.text).toContain('<div id="root">');
    expect(r.headers['cache-control']).toBe('no-cache');
    const csp = r.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain(inlineScriptHashes(HTML)[0]);
    expect(csp).toContain('https://checkout.razorpay.com');
    expect(csp).toContain('https://media.example.com');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('caches hashed assets for a year and leaves /api alone', async () => {
    const a = await request(app).get('/assets/app.js').expect(200);
    expect(a.headers['cache-control']).toContain('immutable');
    const api = await request(app).get('/api/ping').expect(200);
    expect(api.body).toEqual({ ok: true });
    expect(api.headers['content-security-policy']).toBeUndefined();
    await request(app).get('/api/missing').set('Accept', 'text/html').expect(404);
  });

  it('hashes only inline scripts and derives storage origins', () => {
    expect(inlineScriptHashes(HTML)).toHaveLength(1);
    expect(storageOrigins({ endpoint: 'https://acc.r2.cloudflarestorage.com', region: 'auto', bucket: 'media', forcePathStyle: false })).toEqual(['https://acc.r2.cloudflarestorage.com', 'https://media.acc.r2.cloudflarestorage.com']);
    expect(storageOrigins({ region: 'ap-south-1', bucket: 'b', forcePathStyle: false })).toContain('https://b.s3.ap-south-1.amazonaws.com');
    expect(storageOrigins(null)).toEqual([]);
  });
});
