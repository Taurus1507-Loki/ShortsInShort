import type { Word } from './transcription.js';
import { LLMError, type LLMProvider } from './llm.js';
import type { CaptionLine } from '../video/captions.js';

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', hi: 'Hindi', te: 'Telugu', ta: 'Tamil', mr: 'Marathi' };
export const languageName = (code: string) => LANGUAGE_NAMES[code] ?? code;

const bare = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}%₹$]/gu, '');
const lineText = (l: CaptionLine) => l.words.map((w) => w.text).join(' ');

/** Index of the word in `words` that matches `keyword` (exact, then contains). */
export function matchKeyword(words: string[], keyword: string): number {
  const k = bare(keyword);
  if (!k) return -1;
  const exact = words.findIndex((w) => bare(w) === k);
  if (exact >= 0) return exact;
  return words.findIndex((w) => bare(w).includes(k) || (bare(w).length > 2 && k.includes(bare(w))));
}

/* ── AI keyword highlights ─────────────────────────────────────────── */

/** Asks the LLM for the single most important word per line; keeps the rule-based pick on misses. */
export async function aiKeywords(llm: LLMProvider, lines: CaptionLine[], language: string, signal?: AbortSignal): Promise<CaptionLine[]> {
  if (!lines.length) return lines;
  const prompt = [
    `You highlight one word per caption line of a short-form social video (spoken language: ${languageName(language)}).`,
    'For each line choose the single word a viewer should notice: numbers, results, strong verbs or key nouns. Never pick filler words or articles.',
    'Return the word exactly as it appears in the line, or an empty string if no word deserves emphasis.',
    `Return exactly ${lines.length} keywords, in order.`,
    'Lines:',
    JSON.stringify(lines.map(lineText)),
  ].join('\n');
  const out = await llm.generateJson<{ keywords: string[] }>(
    prompt,
    { type: 'OBJECT', properties: { keywords: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['keywords'] },
    { signal, temperature: 0.2 },
  );
  if (!Array.isArray(out.keywords) || out.keywords.length !== lines.length) throw new LLMError('AI keyword count did not match the captions.');
  return lines.map((l, i) => {
    const idx = matchKeyword(
      l.words.map((w) => w.text),
      out.keywords[i] ?? '',
    );
    return idx >= 0 ? { ...l, keywords: [idx] } : l;
  });
}

/* ── Caption translation ───────────────────────────────────────────── */

/** Splits a translated line into tokens timed across the original line (longer tokens get more time). */
export function timeTokens(text: string, start: number, end: number): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const total = tokens.reduce((n, t) => n + Math.max(1, t.length), 0) || 1;
  let t = start;
  return tokens.map((tok) => {
    const d = ((end - start) * Math.max(1, tok.length)) / total;
    const w = { text: tok, start: round3(t), end: round3(t + d) };
    t += d;
    return w;
  });
}

/**
 * Translates caption lines while keeping each line's timing, so captions stay in sync with speech.
 * Word-level timing inside a translated line is approximated (languages reorder words).
 */
export async function translateLines(llm: LLMProvider, lines: CaptionLine[], from: string, to: string, signal?: AbortSignal): Promise<CaptionLine[]> {
  if (!lines.length) return lines;
  const prompt = [
    `Translate these on-screen caption lines from ${languageName(from)} to ${languageName(to)} for a short-form social video.`,
    'Keep each translation short and natural for captions, keep numbers as digits, and keep the same number of lines in the same order — do not merge or split lines.',
    'Also give the single most important word of each translated line, exactly as written in your translation.',
    `Return exactly ${lines.length} items.`,
    'Lines:',
    JSON.stringify(lines.map(lineText)),
  ].join('\n');
  const out = await llm.generateJson<{ lines: Array<{ text: string; keyword: string }> }>(
    prompt,
    {
      type: 'OBJECT',
      properties: {
        lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: { type: 'STRING' }, keyword: { type: 'STRING' } }, required: ['text', 'keyword'] } },
      },
      required: ['lines'],
    },
    { signal, temperature: 0.2 },
  );
  if (!Array.isArray(out.lines) || out.lines.length !== lines.length) throw new LLMError('Translated caption count did not match the original.');
  return lines.map((l, i) => {
    const tr = out.lines[i]!;
    const words = timeTokens(tr.text.trim() || lineText(l), l.start, l.end);
    const idx = matchKeyword(
      words.map((w) => w.text),
      tr.keyword ?? '',
    );
    return { words, start: l.start, end: l.end, keywords: idx >= 0 ? [idx] : [] };
  });
}

/* ── B-roll planning ───────────────────────────────────────────────── */

export interface Sentence {
  start: number;
  end: number;
  text: string;
}
export interface BrollMoment {
  start: number;
  end: number;
  /** Most specific search first. */
  query: string;
  /** Fallback searches, from specific to more common visuals. */
  alternatives?: string[];
}

/** Groups timed words into sentences (punctuation, pauses, or a length cap). */
export function toSentences(words: Word[], maxWords = 16): Sentence[] {
  const out: Sentence[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) out.push({ start: cur[0]!.start, end: cur[cur.length - 1]!.end, text: cur.map((w) => w.text).join(' ') });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end > 0.8) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text) || cur.length >= maxWords) flush();
  }
  flush();
  return out;
}

/** Seconds of video per B-roll clip, by intensity. */
export const BROLL_SPACING: Record<'low' | 'medium' | 'high', number> = { low: 20, medium: 12, high: 7 };

/**
 * Enforces editing rules on proposed moments: never in the opening hook or the final second,
 * 1.5–3.5 s long, at least `minGap` apart, capped in number.
 */
export function scheduleBroll(
  candidates: BrollMoment[],
  opts: { durationSec: number; maxCount: number; minGap?: number; avoidStart?: number; avoidEnd?: number; minLen?: number; maxLen?: number },
): BrollMoment[] {
  const minGap = opts.minGap ?? 2.5;
  const avoidStart = opts.avoidStart ?? 2;
  const avoidEnd = opts.avoidEnd ?? 1;
  const minLen = opts.minLen ?? 1.5;
  const maxLen = opts.maxLen ?? 3.5;
  const out: BrollMoment[] = [];
  for (const c of [...candidates].sort((a, b) => a.start - b.start)) {
    const start = Math.max(c.start, avoidStart);
    const end = Math.min(c.end, start + maxLen, opts.durationSec - avoidEnd);
    if (end - start < minLen || !c.query.trim()) continue;
    const last = out[out.length - 1];
    if (last && start < last.end + minGap) continue;
    out.push({ start: round3(start), end: round3(end), query: c.query.trim().slice(0, 60), ...(c.alternatives?.length ? { alternatives: c.alternatives.map((q) => q.trim().slice(0, 60)).filter(Boolean).slice(0, 3) } : {}) });
    if (out.length >= opts.maxCount) break;
  }
  return out;
}

/** Asks the LLM which sentences deserve a cutaway and what stock footage would illustrate them. */
export async function planBroll(
  llm: LLMProvider,
  sentences: Sentence[],
  opts: { intensity: 'low' | 'medium' | 'high'; durationSec: number; language: string },
  signal?: AbortSignal,
): Promise<BrollMoment[]> {
  const maxCount = Math.max(1, Math.floor(opts.durationSec / BROLL_SPACING[opts.intensity]));
  if (sentences.length < 2) return [];
  const prompt = [
    'You are a professional short-form video editor choosing B-roll cutaways (stock footage shown over the speaker while they keep talking).',
    `The video is ${opts.durationSec.toFixed(0)} seconds long, spoken in ${languageName(opts.language)}. Choose up to ${maxCount} sentences where a visual would make the point clearer or more engaging.`,
    'Rules: never choose sentence 0 (the hook — keep the speaker on screen); prefer concrete, visual ideas; spread choices across the video.',
    'For each choice give 3 ENGLISH stock-footage search queries of 1–3 words, from most specific to most common (e.g. ["graph trending upward", "growth chart", "stock market screen"]). Prefer visuals that commonly exist in free stock libraries; put the main subject LAST in each query. No people\'s names, brands, logos or text.',
    'Sentences (index: text):',
    ...sentences.map((s, i) => `${i}: ${s.text}`),
  ].join('\n');
  const out = await llm.generateJson<{ moments: Array<{ sentence: number; queries: string[] }> }>(
    prompt,
    {
      type: 'OBJECT',
      properties: {
        moments: {
          type: 'ARRAY',
          items: { type: 'OBJECT', properties: { sentence: { type: 'INTEGER' }, queries: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['sentence', 'queries'] },
        },
      },
      required: ['moments'],
    },
    { signal, temperature: 0.4 },
  );
  const candidates = (out.moments ?? [])
    .filter((m) => Number.isInteger(m.sentence) && m.sentence > 0 && m.sentence < sentences.length && Array.isArray(m.queries) && m.queries.some((q) => q?.trim()))
    .map((m) => {
      const s = sentences[m.sentence]!;
      const [query, ...alternatives] = m.queries.filter((q) => q?.trim());
      // Start just after the sentence begins so the cut lands on speech, not before it.
      return { start: s.start + 0.15, end: s.end, query: query!, alternatives };
    });
  return scheduleBroll(candidates, { durationSec: opts.durationSec, maxCount });
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
