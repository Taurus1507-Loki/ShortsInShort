import type { LLMProvider } from '../ai/llm.js';
import type { Word } from '../ai/transcription.js';
import { rankClips, relevance, type StockClip, type StockVideoProvider } from '../ai/stock.js';
import { BROLL_PROFILE, planBroll, scheduleBroll, toSentences } from '../ai/creative.js';
import { fallbackQuery } from '../faceless/scenes.js';
import type { EditBroll, PoolClip } from './edl.js';

/**
 * B-roll for the AI Video Editor timeline: AI picks the moments that need a visual (keywords when the
 * AI is slow or down), then up to 4 matching stock clips are found for each. Used by the "Suggest
 * B-roll" button and by Auto edit.
 */
export const poolClip = (c: StockClip): PoolClip => ({
  id: c.id,
  provider: c.provider,
  downloadUrl: c.downloadUrl,
  pageUrl: c.pageUrl,
  author: c.author,
  thumbnailUrl: c.thumbnailUrl ?? null,
  durationSec: c.durationSec,
  width: c.width,
  height: c.height,
});

/** Keeps the pool bounded: clips in use first, then the newest. */
export function prunePool(pool: Record<string, PoolClip>, broll: EditBroll[], max = 300) {
  const keep = new Set(broll.flatMap((b) => [b.clipId, ...b.candidateIds]));
  const ids = Object.keys(pool);
  if (ids.length <= max) return pool;
  const extra = ids.filter((id) => !keep.has(id)).slice(0, ids.length - max);
  for (const id of extra) delete pool[id];
  return pool;
}

/** How long the AI may take to plan B-roll before keyword picks are used. */
export const BROLL_AI_TIMEOUT_MS = 25_000;

export async function suggestBroll(opts: {
  words: Word[];
  durationSec: number;
  language: string;
  amount: 'low' | 'medium' | 'high';
  pool: Record<string, PoolClip>;
  llm: LLMProvider | null;
  stock: StockVideoProvider;
  signal?: AbortSignal;
}): Promise<{ broll: EditBroll[]; pool: Record<string, PoolClip>; plannedWith: 'ai' | 'keywords' }> {
  const { words, durationSec, language, amount, llm, stock, signal } = opts;
  const sentences = toSentences(words.filter((w) => !w.filler));
  let moments: Array<{ start: number; end: number; query: string; alternatives?: string[] }>;
  let plannedWith: 'ai' | 'keywords' = 'ai';
  try {
    if (!llm) throw new Error('AI is not configured');
    const limit = AbortSignal.timeout(BROLL_AI_TIMEOUT_MS);
    moments = await planBroll(llm, sentences, { intensity: amount, durationSec, language }, signal ? AbortSignal.any([signal, limit]) : limit);
  } catch (err) {
    if (signal?.aborted) throw err;
    plannedWith = 'keywords';
    const profile = BROLL_PROFILE[amount];
    moments = scheduleBroll(
      sentences
        .slice(1)
        .filter((_, i) => amount === 'high' || i % 2 === 0)
        .map((s) => ({ start: s.start, end: s.end, query: fallbackQuery(s.text) }))
        .filter((m) => m.query),
      { durationSec, maxCount: Math.max(1, Math.floor(durationSec / profile.spacing)), minGap: profile.minGap, maxLen: profile.maxLen, preferredLen: profile.preferredLen },
    );
  }
  const pool: Record<string, PoolClip> = { ...opts.pool };
  const used = new Set<string>();
  const broll: EditBroll[] = [];
  for (const m of moments) {
    if (signal?.aborted) throw new Error('Processing was cancelled.');
    let found: StockClip[] = [];
    let query = m.query;
    for (const q of [m.query, ...(m.alternatives ?? [])]) {
      try {
        const clips = await stock.searchVideos(q, { perPage: 10, minDurationSec: Math.ceil(m.end - m.start) });
        found = rankClips(clips, q)
          .filter((c) => !used.has(c.id) && relevance(c, q) > 0 && c.downloadUrl.startsWith('https://'))
          .slice(0, 4);
      } catch {
        found = [];
      }
      if (found.length) {
        query = q;
        break;
      }
    }
    if (!found.length) continue;
    found.forEach((c) => (pool[c.id] = poolClip(c)));
    used.add(found[0]!.id);
    broll.push({ start: Math.round(m.start * 1000) / 1000, end: Math.round(m.end * 1000) / 1000, query, clipId: found[0]!.id, candidateIds: found.map((c) => c.id) });
  }
  return { broll, pool: prunePool(pool, broll), plannedWith };
}
