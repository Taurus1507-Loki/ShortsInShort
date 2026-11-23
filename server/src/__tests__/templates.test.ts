import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app, connectTestDb, registerUser, resetDb } from './helpers.js';
import { TEMPLATE_CATEGORIES, TEMPLATE_NICHES, VIDEO_TEMPLATES } from '../config/templates.js';
import { createProjectSchema } from '../modules/projects/projects.schemas.js';
import { motionSceneSchema } from '../services/faceless/motion.js';
import { setStockProvider, type StockClip, type StockVideoProvider } from '../services/ai/stock.js';

beforeAll(connectTestDb);
beforeEach(resetDb);
afterEach(() => setStockProvider(undefined));
afterAll(() => mongoose.disconnect());

describe('template catalogue', () => {
  it('has unique ids and every template creates a valid project', () => {
    expect(new Set(VIDEO_TEMPLATES.map((t) => t.id)).size).toBe(VIDEO_TEMPLATES.length);
    for (const t of VIDEO_TEMPLATES) {
      expect(TEMPLATE_CATEGORIES).toContain(t.category);
      const r = createProjectSchema.safeParse({ mode: t.mode, title: t.title, aspectRatio: t.aspectRatio, style: t.style, script: t.script, topic: t.topic, settings: t.settings });
      expect(r.success, `${t.id}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
      if (t.mode !== 'editor') expect(t.script.length, t.id).toBeLessThanOrEqual(5000);
    }
  });

  it('says who every template is for, and every niche has templates', () => {
    for (const t of VIDEO_TEMPLATES) {
      expect(t.niches.length, t.id).toBeGreaterThan(0);
      for (const n of t.niches) expect(TEMPLATE_NICHES, t.id).toContain(n);
    }
    for (const n of TEMPLATE_NICHES) expect(VIDEO_TEMPLATES.some((t) => t.niches.includes(n)), n).toBe(true);
  });

  it('has valid sample scenes for every Motion template and a preview for every template', () => {
    for (const t of VIDEO_TEMPLATES) {
      expect(Boolean(t.motionScenes || t.previewQuery), `${t.id} needs a preview`).toBe(true);
      if (t.settings.facelessStyle === 'motion') expect(t.motionScenes?.length, t.id).toBeGreaterThan(0);
      for (const sc of t.motionScenes ?? []) expect(motionSceneSchema.safeParse(sc).success, `${t.id}: ${JSON.stringify(sc)}`).toBe(true);
    }
  });
});

describe('templates API', () => {
  it('lists templates and remembers favourites per user', async () => {
    await request(app).get('/api/templates').expect(401);
    const a = await registerUser({ verify: true });
    const b = await registerUser({ verify: true });
    const list = (await request(app).get('/api/templates').set(a.auth).expect(200)).body.data;
    expect(list).toHaveLength(VIDEO_TEMPLATES.length);
    expect(list.find((t: { id: string }) => t.id === 'tool-explainer')).toMatchObject({ preview: 'motion', favorite: false });
    await request(app).put('/api/templates/product-promo/favorite').set(a.auth).expect(200);
    await request(app).put('/api/templates/product-promo/favorite').set(a.auth).expect(200); // idempotent
    await request(app).put('/api/templates/nope/favorite').set(a.auth).expect(404);
    const fav = (await request(app).get('/api/templates').set(a.auth)).body.data.filter((t: { favorite: boolean }) => t.favorite);
    expect(fav.map((t: { id: string }) => t.id)).toEqual(['product-promo']);
    expect((await request(app).get('/api/templates').set(b.auth)).body.data.some((t: { favorite: boolean }) => t.favorite)).toBe(false);
    await request(app).delete('/api/templates/product-promo/favorite').set(a.auth).expect(200);
    expect((await request(app).get('/api/templates').set(a.auth)).body.data.some((t: { favorite: boolean }) => t.favorite)).toBe(false);
  });

  it('previews stock templates with provider thumbnails (cached), and nothing without a provider', async () => {
    const a = await registerUser({ verify: true });
    setStockProvider(null);
    expect((await request(app).get('/api/templates/recipe/preview').set(a.auth).expect(200)).body.data.thumbnails).toEqual([]);
    let searches = 0;
    const clip = (id: string, tags: string[], thumb: string | null): StockClip => ({ id, provider: 'pixabay', downloadUrl: 'https://cdn.example/x.mp4', pageUrl: 'https://pixabay.com/v', author: 'a', width: 1280, height: 720, durationSec: 10, tags, thumbnailUrl: thumb });
    const stock: StockVideoProvider = {
      name: 'fake', license: 'test',
      searchVideos: async () => {
        searches++;
        return [clip('1', ['river'], 'https://img.example/1.jpg'), clip('2', ['tea', 'kitchen'], 'https://img.example/2.jpg'), clip('3', ['tea'], 'http://insecure/3.jpg')];
      },
      download: async () => undefined,
    };
    setStockProvider(stock);
    const r = (await request(app).get('/api/templates/recipe/preview').set(a.auth).expect(200)).body.data;
    expect(r.thumbnails).toEqual(['https://img.example/2.jpg', 'https://img.example/1.jpg']); // best match first; never http
    await request(app).get('/api/templates/recipe/preview').set(a.auth).expect(200);
    expect(searches).toBe(1);
    expect(JSON.stringify(r)).not.toContain('x.mp4'); // video files are never exposed
    await request(app).get('/api/templates/missing/preview').set(a.auth).expect(404);
  });
});
