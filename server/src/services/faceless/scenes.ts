import { createHash } from 'node:crypto';
import type { LLMProvider } from '../ai/llm.js';
import { rankClips, relevance, type StockClip, type StockVideoProvider } from '../ai/stock.js';

export interface SceneDraft {
  text: string;
}

const wps = (language: string) => (language === 'en' ? 2.5 : 2.1);
const tokens = (s: string) => s.split(/\s+/).filter(Boolean);
export const MAX_SCENES = 40;

/** Fingerprint of the script a scene plan was made for. */
export const scenesKey = (script: string) => createHash('sha1').update(script.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 16);

/**
 * Splits a script into scenes of roughly 3–8 seconds of speech, in order and without losing a word:
 * sentences are merged until a scene is long enough, and long sentences are split at commas or word
 * boundaries. Done in code so the LLM can never drop or rewrite narration. Exported for tests.
 */
export function splitScenes(script: string, language = 'en'): SceneDraft[] {
  const text = script.replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  const minWords = Math.round(3.5 * wps(language));
  const maxWords = Math.round(8 * wps(language));
  const sentences = (text.match(/[^.!?।\n]+(?:[.!?।]+|\n+|$)/g) ?? [text]).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

  // Break over-long sentences at commas, then at word boundaries.
  const pieces: string[] = [];
  for (const s of sentences) {
    if (tokens(s).length <= maxWords) {
      pieces.push(s);
      continue;
    }
    let cur: string[] = [];
    for (const part of s.split(/(?<=[,;:])\s+/)) {
      const w = tokens(part);
      if (cur.length && cur.length + w.length > maxWords) {
        pieces.push(cur.join(' '));
        cur = [];
      }
      for (const word of w) {
        cur.push(word);
        if (cur.length >= maxWords) {
          pieces.push(cur.join(' '));
          cur = [];
        }
      }
    }
    if (cur.length) pieces.push(cur.join(' '));
  }

  // Merge short pieces so scenes aren't flashes.
  const scenes: string[] = [];
  for (const p of pieces) {
    const last = scenes[scenes.length - 1];
    if (last !== undefined && tokens(last).length < minWords && tokens(last).length + tokens(p).length <= maxWords) scenes[scenes.length - 1] = `${last} ${p}`;
    else scenes.push(p);
  }
  if (scenes.length > 1 && tokens(scenes[scenes.length - 1]!).length < minWords / 2) {
    const tail = scenes.pop()!;
    scenes[scenes.length - 1] = `${scenes[scenes.length - 1]} ${tail}`;
  }
  // Hard cap: merge neighbours evenly if a very long script would make too many scenes.
  while (scenes.length > MAX_SCENES) {
    let best = 0;
    for (let i = 1; i < scenes.length - 1; i++) if (tokens(scenes[i]!).length + tokens(scenes[i + 1]!).length < tokens(scenes[best]!).length + tokens(scenes[best + 1]!).length) best = i;
    scenes.splice(best, 2, `${scenes[best]} ${scenes[best + 1]}`);
  }
  return scenes.map((t) => ({ text: t }));
}

const STOP = new Set('the a an and or but of to in on for with is are was were be this that these those it its you your we our they their i my me as at by from not no so if then than just very can will do does did have has had into about more most what when how why who'.split(' '));

/** Simple fallback search: the longest meaningful words of the scene (Latin scripts only). */
export function fallbackQuery(text: string): string {
  const words = tokens(text.toLowerCase().replace(/[^a-z\s]/g, ' ')).filter((w) => w.length > 3 && !STOP.has(w));
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 2).join(' ');
}

/**
 * Asks the LLM for three English stock-footage searches per scene (specific → common). The scene
 * texts are fixed; the model only chooses visuals. Missing/invalid answers fall back to keywords.
 */
export async function planSceneQueries(llm: LLMProvider, scenes: SceneDraft[], opts: { language: string; topic?: string }, signal?: AbortSignal): Promise<string[][]> {
  const prompt = [
    'You are a video editor choosing stock footage for a faceless short video. Each scene below is narrated; pick visuals that SHOW what is being said.',
    opts.topic ? `Video topic: ${opts.topic}` : '',
    `The narration is in ${opts.language === 'en' ? 'English' : `language code "${opts.language}"`}.`,
    'For EVERY scene give exactly 3 ENGLISH stock-video search queries of 1–3 words, most specific first, most common last (e.g. ["coffee pouring cup", "morning coffee", "coffee"]).',
    'Prefer concrete things that exist in free stock libraries (people, places, objects, nature, cities, technology). Put the main subject LAST. No names of people, brands, logos or on-screen text. Vary visuals between neighbouring scenes.',
    'Scenes (index: narration):',
    ...scenes.map((s, i) => `${i}: ${s.text}`),
  ]
    .filter(Boolean)
    .join('\n');
  const out = await llm.generateJson<{ scenes: Array<{ index: number; queries: string[] }> }>(
    prompt,
    {
      type: 'OBJECT',
      properties: {
        scenes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { index: { type: 'INTEGER' }, queries: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['index', 'queries'] } },
      },
      required: ['scenes'],
    },
    { signal, temperature: 0.4 },
  );
  const byIndex = new Map<number, string[]>();
  for (const s of out?.scenes ?? []) {
    if (!Number.isInteger(s?.index) || s.index < 0 || s.index >= scenes.length || !Array.isArray(s.queries)) continue;
    const q = s.queries.map((x) => String(x).replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)).filter((x) => x.length > 1).slice(0, 3);
    if (q.length) byIndex.set(s.index, q);
  }
  return scenes.map((s, i) => byIndex.get(i) ?? [fallbackQuery(s.text) || 'abstract background']);
}

/**
 * Finds up to `max` relevant clips for a scene: tries each query in turn and keeps clips whose tags
 * match it (no unrelated footage), skipping clips already used in this video.
 */
export async function findClips(stock: StockVideoProvider, queries: string[], opts: { minDurationSec: number; used?: Set<string>; max?: number; signal?: AbortSignal }): Promise<StockClip[]> {
  const out: StockClip[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const clips = await stock.searchVideos(q, { perPage: 10, minDurationSec: Math.max(1, Math.floor(opts.minDurationSec)), signal: opts.signal });
    for (const c of rankClips(clips, q)) {
      if (seen.has(c.id) || relevance(c, q) <= 0) continue;
      seen.add(c.id);
      out.push(c);
    }
    if (out.length >= (opts.max ?? 4)) break;
  }
  const fresh = out.filter((c) => !opts.used?.has(c.id));
  return [...fresh, ...out.filter((c) => opts.used?.has(c.id))].slice(0, opts.max ?? 4);
}

/**
 * Start/end of each scene on the voiceover timeline. Scenes partition the script in order and the
 * voiceover's words come from the same text, so word counts line up; each scene runs until the next
 * one starts and the last runs to the end. Falls back to splitting time by character length when
 * word timings are missing or don't line up. Exported for tests.
 */
export function sceneTimings(scenes: Array<{ text: string }>, words: Array<{ start: number; end: number }>, totalSec: number): Array<{ start: number; end: number }> {
  if (!scenes.length) return [];
  const counts = scenes.map((s) => tokens(s.text).length);
  const total = counts.reduce((a, b) => a + b, 0);
  let starts: number[];
  if (words.length && Math.abs(words.length - total) <= Math.max(2, total * 0.05)) {
    let idx = 0;
    starts = counts.map((c, i) => {
      const at = i === 0 ? 0 : (words[Math.min(idx, words.length - 1)]?.start ?? 0);
      idx += c;
      return at;
    });
  } else {
    const chars = scenes.map((s) => s.text.length);
    const sum = chars.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    starts = chars.map((c) => {
      const at = (acc / sum) * totalSec;
      acc += c;
      return at;
    });
  }
  return starts.map((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]! : totalSec;
    return { start: Math.round(s * 1000) / 1000, end: Math.round(Math.max(end, s + 0.3) * 1000) / 1000 };
  });
}
