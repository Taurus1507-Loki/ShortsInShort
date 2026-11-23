import type { LLMProvider } from '../ai/llm.js';
import type { Word } from '../ai/transcription.js';
import type { StockVideoProvider } from '../ai/stock.js';
import { languageName, toSentences, type Sentence } from '../ai/creative.js';
import { MOODS, STYLE_MOOD, loadLibrary, pickTrack } from '../ai/music.js';
import { logger } from '../../config/logger.js';
import type { Interval } from './silence.js';
import { suggestBroll } from './brollSuggest.js';
import { fromOutputTime, keepSegments, toOutputTime, type AutoSummary, type EditCaption, type EditDoc, type EditSfx, type EditText, type EditZoom } from './edl.js';

/**
 * Auto edit: one button turns analysed footage into a finished edit on the timeline — pauses and
 * filler words cut, a hook line on screen, B-roll, punch-in zooms on key words, music matched to the
 * mood and sound effects on every visual change. Everything lands on the timeline, so the user can
 * still change any of it before exporting.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** How long the AI may take to write the hook before the rule-based one is used. */
export const HOOK_AI_TIMEOUT_MS = 20_000;
/** On-screen time of the hook line (seconds of the edited video). */
export const HOOK_SEC = 2.8;

/** Words with trailing punctuation trimmed, capped. */
function clip(text: string, maxWords: number) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const cut = words.slice(0, maxWords).join(' ').replace(/[,;:–—-]+$/, '');
  return words.length > maxWords ? `${cut.replace(/[.!?…]+$/, '')}…` : cut;
}

/** Rule-based hook: the first question near the start, else the opening sentence, at most 7 words. */
export function fallbackHook(sentences: Sentence[]): string | null {
  if (!sentences.length) return null;
  const early = sentences.slice(0, Math.max(2, Math.ceil(sentences.length * 0.3)));
  const pick = early.find((s) => /\?\s*$/.test(s.text)) ?? sentences[0]!;
  const text = clip(pick.text, 7);
  return text.length >= 3 ? text.slice(0, 80) : null;
}

/** AI writes the hook and picks the music mood (same call). Throws when the AI fails. */
export async function aiHookAndMood(llm: LLMProvider, sentences: Sentence[], opts: { language: string; style: string }, signal?: AbortSignal): Promise<{ hook: string; mood: string }> {
  const transcript = sentences
    .map((s) => s.text)
    .join(' ')
    .slice(0, 6000);
  const prompt = [
    'You are a top short-form video editor (Instagram Reels, YouTube Shorts).',
    `Write the on-screen HOOK for this ${opts.style.replace(/_/g, ' ')} video: a bold first line shown in the first 3 seconds that makes people stop scrolling.`,
    `Rules: 3–7 words; in ${languageName(opts.language)} (the language of the video, in its usual script); true to what the speaker says; no hashtags, emoji or quotation marks; no clickbait lies.`,
    `Also pick the background-music mood that fits the video best, one of: ${MOODS.join(', ')}.`,
    'Transcript:',
    transcript,
  ].join('\n');
  const out = await llm.generateJson<{ hook: string; mood: string }>(
    prompt,
    {
      type: 'OBJECT',
      properties: { hook: { type: 'STRING' }, mood: { type: 'STRING', enum: [...MOODS] } },
      required: ['hook', 'mood'],
    },
    { signal, temperature: 0.7 },
  );
  const hook = clip(String(out.hook ?? '').replace(/["“”#]/g, ''), 9).slice(0, 80);
  if (hook.length < 3) throw new Error('The AI returned no hook.');
  return { hook, mood: (MOODS as readonly string[]).includes(out.mood) ? out.mood : (STYLE_MOOD[opts.style] ?? 'upbeat') };
}

/** The hook as a timeline text: big, on a coloured box, at the top, for the first ~2.8 s of the edit. */
export function hookText(hook: string, segments: Interval[], color: string): EditText | null {
  const total = segments.reduce((n, s) => n + (s.end - s.start), 0);
  if (!segments.length || total < 4) return null;
  const start = segments[0]!.start;
  const end = fromOutputTime(segments, Math.min(HOOK_SEC, total - 0.5));
  return end > start + 0.5 ? { start: r2(start), end: r2(end), text: hook, position: 'top', style: 'accent', size: 'l', color } : null;
}

const overlaps = (a: Interval, list: Interval[]) => list.some((b) => a.start < b.end && b.start < a.end);

/**
 * Punch-in zooms on the highlighted word of caption lines (or line starts when nothing is
 * highlighted): at most one every 4 s, never during B-roll, alternating medium and strong.
 */
export function planAutoZooms(captions: EditCaption[], segments: Interval[], avoid: Interval[], minGap = 4): EditZoom[] {
  const zooms: EditZoom[] = [];
  let last = -Infinity;
  for (const c of captions) {
    const w = c.words[c.keyword >= 0 ? c.keyword : 0];
    if (!w) continue;
    if (c.keyword < 0 && c.words.length < 4) continue;
    const at = r2(Math.max(0, w.start - 0.12));
    const zone = { start: at, end: at + 1.6 };
    if (at - last < minGap || toOutputTime(segments, w.start) === null || overlaps(zone, avoid)) continue;
    zooms.push({ at, dur: 1.5, scale: zooms.length % 2 ? 1.2 : 1.12 });
    last = at;
  }
  return zooms;
}

/**
 * Sound effects: an impact on the hook, a whoosh into and out of every B-roll clip, a pop on every
 * zoom. Effects closer than 0.6 s to the previous one are dropped so they never crowd the voice.
 */
export function planAutoSfx(opts: { hook: EditText | null; broll: Interval[]; zooms: EditZoom[]; durationSec: number; segments: Interval[] }): EditSfx[] {
  const cues: EditSfx[] = [];
  if (opts.hook) cues.push({ at: opts.hook.start, kind: 'impact' });
  for (const b of opts.broll) {
    cues.push({ at: r2(b.start), kind: 'whoosh' });
    if (b.end < opts.durationSec - 0.4) cues.push({ at: r2(b.end), kind: 'whoosh', volume: 0.7 });
  }
  for (const z of opts.zooms) cues.push({ at: z.at, kind: 'pop', volume: 0.8 });
  const kept = cues.filter((c) => toOutputTime(opts.segments, c.at) !== null).sort((a, b) => a.at - b.at);
  const out: EditSfx[] = [];
  for (const c of kept) {
    const prev = out[out.length - 1];
    if (prev && c.at - prev.at < 0.6) continue;
    out.push(c);
  }
  return out.slice(0, 120);
}

export interface AutoEditInput {
  edit: EditDoc;
  words: Word[];
  language: string;
  style: string;
  projectId: string;
  pace: 'natural' | 'fast';
  /** Hook box colour (the project's highlight colour). */
  color: string;
  llm: LLMProvider | null;
  stock: StockVideoProvider | null;
  signal?: AbortSignal;
}

/** Applies Auto edit to an analysed edit. Never fails for an AI or stock outage: it falls back and notes it. */
export async function autoEdit(input: AutoEditInput): Promise<EditDoc> {
  const { edit, llm, stock, signal } = input;
  const words = input.words.filter((w) => !w.filler);
  const notes: string[] = [];
  const next: EditDoc = { ...edit, pauseSec: input.pace === 'fast' ? 0.3 : 0.6, removeFillers: true };
  next.segments = keepSegments(next);
  const sentences = toSentences(words);

  const hookJob = (async () => {
    if (!llm || sentences.length < 1) return null;
    const limit = AbortSignal.timeout(HOOK_AI_TIMEOUT_MS);
    try {
      return await aiHookAndMood(llm, sentences, { language: input.language, style: input.style }, signal ? AbortSignal.any([signal, limit]) : limit);
    } catch (err) {
      if (signal?.aborted) throw err;
      logger.warn({ err }, 'Auto edit: AI hook failed or was slow; using the opening line');
      return null;
    }
  })();
  const brollJob = (async () => {
    if (!stock) {
      notes.push('B-roll was skipped: stock footage is not enabled on this server.');
      return null;
    }
    if (words.length < 8) {
      notes.push('B-roll was skipped: there is too little speech to choose visuals from.');
      return null;
    }
    try {
      return await suggestBroll({ words, durationSec: edit.durationSec, language: input.language, amount: 'medium', pool: edit.brollPool ?? {}, llm, stock, signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      logger.warn({ err }, 'Auto edit: B-roll failed');
      notes.push('B-roll was skipped: the stock footage search failed.');
      return null;
    }
  })();
  const [ai, broll] = await Promise.all([hookJob, brollJob]);

  // Hook
  const hookLine = ai?.hook ?? fallbackHook(sentences);
  const hook = hookLine ? hookText(hookLine, next.segments, input.color) : null;
  next.texts = hook ? [hook] : [];
  if (!hook) notes.push('No hook line was added: the video is too short or has no speech.');

  // B-roll (never over the hook, so the speaker is on screen for the first line)
  if (broll) {
    next.broll = broll.broll.filter((b) => !hook || b.start >= hook.end);
    next.brollPool = broll.pool;
    if (!next.broll.length) notes.push('No closely matching stock clips were found, so no B-roll was added.');
  } else next.broll = [];

  // Zooms on key words
  next.zooms = planAutoZooms(next.captions ?? [], next.segments, (next.broll ?? []).map((b) => ({ start: b.start - 0.3, end: b.end + 0.3 })));

  // Music matched to the mood
  const mood = ai?.mood ?? STYLE_MOOD[input.style] ?? 'upbeat';
  const track = pickTrack(loadLibrary(), mood, input.style, input.projectId);
  if (track) next.music = { mode: 'track', file: track.file, volume: 0.22, duck: true };
  else notes.push('No music was added: the music library is empty (an admin adds tracks in Admin → Music library).');

  // Sound effects
  next.sfx = planAutoSfx({ hook, broll: next.broll ?? [], zooms: next.zooms, durationSec: edit.durationSec, segments: next.segments });

  const summary: AutoSummary = {
    at: new Date().toISOString(),
    hook: hook?.text ?? null,
    hookBy: hook ? (ai ? 'ai' : 'rules') : null,
    mood,
    brollBy: broll ? broll.plannedWith : null,
    counts: { broll: next.broll?.length ?? 0, zooms: next.zooms.length, sfx: next.sfx.length },
    music: track ? `${track.title} — ${track.artist}` : null,
    notes,
  };
  next.auto = summary;
  return next;
}
