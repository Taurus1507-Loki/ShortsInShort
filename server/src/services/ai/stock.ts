import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '../../config/env.js';

export interface StockClip {
  id: string;
  provider: string;
  /** Direct file URL to download (never shown to end users / hotlinked). */
  downloadUrl: string;
  /** Public page for attribution. */
  pageUrl: string;
  author: string;
  width: number;
  height: number;
  durationSec: number;
  /** Provider keywords describing the clip (used to rank relevance). */
  tags?: string[];
}

const stem = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(ies)$/, 'y').replace(/(es|s)$/, '');

/**
 * Orders clips by how well their tags match the query. Later query words weigh more because English
 * search phrases put the subject last ("stacking gold coins" is about coins); plurals match singulars.
 * Ties keep the provider's own ranking.
 */
export function relevance(clip: StockClip, query: string): number {
  const words = query.split(/\s+/).map(stem).filter((w) => w.length > 1);
  const tags = new Set((clip.tags ?? []).flatMap((t) => t.split(/\s+/)).map(stem));
  return words.reduce((sum, w, i) => sum + (tags.has(w) ? i + 1 : 0), 0);
}

export function rankClips(clips: StockClip[], query: string): StockClip[] {
  return clips
    .map((c, i) => ({ c, i, s: relevance(c, query) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}

/** Licensed stock-footage source. Add Pexels/Storyblocks adapters alongside. */
export interface StockVideoProvider {
  readonly name: string;
  readonly license: string;
  searchVideos(query: string, opts?: { perPage?: number; minDurationSec?: number; signal?: AbortSignal }): Promise<StockClip[]>;
  download(clip: StockClip, dest: string, opts?: { signal?: AbortSignal }): Promise<void>;
}

export class StockError extends Error {}

interface PixabayHit {
  id: number;
  pageURL: string;
  duration: number;
  user: string;
  tags?: string;
  videos: Record<string, { url: string; width: number; height: number; size: number }>;
}

/** Picks a 720p-ish rendition: sharp enough for 1080p B-roll, small enough to download quickly. */
function pickRendition(v: PixabayHit['videos']) {
  for (const k of ['medium', 'small', 'large', 'tiny']) if (v[k]?.url) return v[k];
  return null;
}

/** Maps a Pixabay video search response to clips. Exported for tests. */
export function parsePixabayVideos(body: unknown): StockClip[] {
  const hits = (body as { hits?: PixabayHit[] })?.hits ?? [];
  return hits.flatMap((h) => {
    const r = pickRendition(h.videos ?? {});
    if (!r) return [];
    return [{ id: String(h.id), provider: 'pixabay', downloadUrl: r.url, pageUrl: h.pageURL, author: h.user, width: r.width, height: r.height, durationSec: h.duration, tags: (h.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean) }];
  });
}

/**
 * Pixabay videos (Pixabay Content License: free for commercial use, no attribution required — we
 * still record the source page and author for every clip used).
 * REQUIRES `PIXABAY_API_KEY`.
 */
export class PixabayProvider implements StockVideoProvider {
  readonly name = 'pixabay';
  readonly license = 'Pixabay Content License';
  constructor(private readonly apiKey: string) {}

  async searchVideos(query: string, opts: { perPage?: number; minDurationSec?: number; signal?: AbortSignal } = {}) {
    const qs = new URLSearchParams({ key: this.apiKey, q: query.slice(0, 100), per_page: String(Math.max(3, opts.perPage ?? 5)), safesearch: 'true', video_type: 'film' });
    const res = await fetch(`https://pixabay.com/api/videos/?${qs}`, { signal: opts.signal ?? AbortSignal.timeout(20_000) });
    if (!res.ok) throw new StockError(res.status === 400 || res.status === 403 ? 'Stock media provider rejected the API key.' : `Stock search failed (HTTP ${res.status}).`);
    return parsePixabayVideos(await res.json()).filter((c) => c.durationSec >= (opts.minDurationSec ?? 0));
  }

  async download(clip: StockClip, dest: string, opts: { signal?: AbortSignal } = {}) {
    const res = await fetch(clip.downloadUrl, { signal: opts.signal ?? AbortSignal.timeout(60_000) });
    if (!res.ok || !res.body) throw new StockError(`Could not download stock clip (HTTP ${res.status}).`);
    const max = 80 * 1024 * 1024;
    let bytes = 0;
    try {
      await pipeline(
        Readable.fromWeb(res.body as never),
        async function* (src) {
          for await (const chunk of src) {
            bytes += (chunk as Buffer).length;
            if (bytes > max) throw new StockError('Stock clip too large.');
            yield chunk;
          }
        },
        createWriteStream(dest),
      );
    } catch (err) {
      await rm(dest, { force: true });
      throw err;
    }
  }
}

let override: StockVideoProvider | null | undefined;
export function setStockProvider(p: StockVideoProvider | null | undefined) {
  override = p;
}
export function getStockProvider(): StockVideoProvider | null {
  if (override !== undefined) return override;
  return env.ai.pixabay ? new PixabayProvider(env.ai.pixabay.apiKey) : null;
}
