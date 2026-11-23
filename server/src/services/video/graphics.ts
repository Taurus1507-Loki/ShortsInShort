import path from 'node:path';
import type { LLMProvider } from '../ai/llm.js';
import { languageName, type Sentence } from '../ai/creative.js';
import { MOTION_ICONS } from '../faceless/motion.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { MOTION_FPS, motionServeUrl } from './motionRender.js';
import type { Interval } from './silence.js';
import { GRAPHIC_EMOJI, graphicSchema, toOutputTime, type EditGraphic } from './edl.js';

/**
 * Motion graphics for the AI Video Editor: AI reads the transcript and places animated number
 * counters, emoji pop-ups and callout cards where they make a point land (rules from the words when
 * the AI is slow or down). The export renders each one with the same React component the live
 * preview plays, on a transparent background, and FFmpeg lays it over the footage.
 */

type Emoji = (typeof GRAPHIC_EMOJI)[number];
const r2 = (n: number) => Math.round(n * 100) / 100;

/** How long the AI may take to plan graphics before the word rules are used. */
export const GRAPHICS_AI_TIMEOUT_MS = 20_000;
/** Seconds a graphic stays on screen (capped by its sentence). */
const SHOW_SEC = 2.6;

/** "1%", "₹10,000", "300", "3x", "50K", "$2.5M" → a counter, or null. Exported for tests. */
export function parseNumber(token: string): { value: number; prefix?: string; suffix?: string } | null {
  const m = token.replace(/[.,!?;:]+$/, '').match(/^([₹$€£])?(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)(%|x|k|m|cr|l|lakh|crore)?$/i);
  if (!m) return null;
  const value = Number(m[2]!.replace(/,/g, ''));
  if (!Number.isFinite(value) || value === 0) return null;
  const unit = m[3]?.toLowerCase();
  const suffix = unit === '%' ? '%' : unit === 'x' ? 'x' : unit === 'k' ? 'K' : unit === 'm' ? 'M' : unit === 'cr' || unit === 'crore' ? ' Cr' : unit === 'l' || unit === 'lakh' ? ' L' : undefined;
  // A bare year or small number alone ("2024", "2") is rarely worth animating.
  if (!m[1] && !suffix && (value < 10 || (value >= 1900 && value <= 2100))) return null;
  return { value, ...(m[1] ? { prefix: m[1] } : {}), ...(suffix ? { suffix } : {}) };
}

const TOPIC_EMOJI: Array<[RegExp, Emoji]> = [
  [/money|price|₹|\$|earn|profit|income|save|sales|revenue|rich/i, 'hundred'],
  [/love|favourite|favorite|beautiful|amazing|perfect/i, 'heart_eyes'],
  [/funny|joke|lol|laugh|hilarious/i, 'laughing'],
  [/wow|crazy|insane|mind|shock|secret|unbelievable|surpris/i, 'mind_blown'],
  [/idea|tip|hack|trick|learn|smart/i, 'idea'],
  [/fast|grow|launch|boost|scale|speed|faster|skyrocket/i, 'rocket'],
  [/hot|trend|viral|popular/i, 'fire'],
  [/win|success|celebrat|congrat|finally|goal/i, 'party'],
];

interface Moment {
  sentence: number;
  graphic: Omit<EditGraphic, 'start' | 'end'>;
}

/** Word rules: a counter for every number said, an emoji for a few strong words. */
export function ruleMoments(sentences: Sentence[]): Moment[] {
  const out: Moment[] = [];
  sentences.forEach((s, i) => {
    const words = s.text.split(/\s+/);
    const num = words.map(parseNumber).find(Boolean);
    if (num) {
      const after = words.slice(words.findIndex((w) => parseNumber(w)) + 1, words.findIndex((w) => parseNumber(w)) + 3).join(' ').replace(/[.,!?;:]+$/, '');
      out.push({ sentence: i, graphic: { kind: 'counter', ...num, ...(after && !num.suffix ? { label: after.slice(0, 40) } : {}), position: 'middle' } });
      return;
    }
    const emoji = TOPIC_EMOJI.find(([re]) => re.test(s.text))?.[1];
    if (emoji && i > 0) out.push({ sentence: i, graphic: { kind: 'emoji', emoji, position: 'top' } });
  });
  return out;
}

/** "%", "x", "K" stick to the number; words ("days") get a space before them. Exported for tests. */
export function counterSuffix(v: unknown): string | undefined {
  const t = typeof v === 'string' ? v.trim().slice(0, 9) : '';
  if (!t) return undefined;
  return /^[\p{L}]{2,}/u.test(t) ? ` ${t}` : t;
}

/** AI picks the moments and writes each graphic. Throws when the AI fails. */
export async function aiMoments(llm: LLMProvider, sentences: Sentence[], opts: { language: string; max: number }, signal?: AbortSignal): Promise<Moment[]> {
  const prompt = [
    'You are a top short-form video editor adding motion graphics over a person talking (Instagram Reels, YouTube Shorts).',
    `Choose up to ${opts.max} sentences where a graphic makes the point land, spread across the video. Never sentence 0 (the hook).`,
    'Graphic kinds:',
    '- counter: an animated number for a statistic, amount, percentage or count the speaker SAYS (value = the number; prefix like ₹ or $; suffix like %, x, K, M, " days"; label = 1–3 words for what it counts).',
    `- emoji: an animated emoji reacting to a strong moment. emoji is one of: ${GRAPHIC_EMOJI.join(', ')}; optional label of 1–3 words.`,
    `- callout: the key idea of the sentence as a short card. text = 2–6 words; heading = optional 1–2 words like "Tip" or "Step 1"; icon one of: ${MOTION_ICONS.join(', ')}.`,
    `Prefer counters whenever a number is said. Write labels, text and headings in ${languageName(opts.language)} (the video's language, in its usual script). Never invent numbers the speaker did not say.`,
    'Sentences (index: text):',
    ...sentences.map((s, i) => `${i}: ${s.text}`),
  ].join('\n');
  const out = await llm.generateJson<{ graphics: Array<Record<string, unknown>> }>(
    prompt,
    {
      type: 'OBJECT',
      properties: {
        graphics: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              sentence: { type: 'INTEGER' },
              kind: { type: 'STRING', enum: ['counter', 'emoji', 'callout'] },
              value: { type: 'NUMBER' },
              prefix: { type: 'STRING' },
              suffix: { type: 'STRING' },
              label: { type: 'STRING' },
              emoji: { type: 'STRING', enum: [...GRAPHIC_EMOJI] },
              text: { type: 'STRING' },
              heading: { type: 'STRING' },
              icon: { type: 'STRING', enum: [...MOTION_ICONS] },
            },
            required: ['sentence', 'kind'],
          },
        },
      },
      required: ['graphics'],
    },
    { signal, temperature: 0.4 },
  );
  const moments: Moment[] = [];
  for (const g of out.graphics ?? []) {
    const sentence = Number(g.sentence);
    if (!Number.isInteger(sentence) || sentence <= 0 || sentence >= sentences.length) continue;
    const kind = g.kind as EditGraphic['kind'];
    const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
    const graphic = {
      kind,
      position: kind === 'emoji' ? ('top' as const) : ('middle' as const),
      ...(kind === 'counter' ? { value: Number(g.value), prefix: clean(g.prefix, 4), suffix: counterSuffix(g.suffix), label: clean(g.label, 40) } : {}),
      ...(kind === 'emoji' ? { emoji: g.emoji as Emoji, label: clean(g.label, 40) } : {}),
      ...(kind === 'callout' ? { text: clean(g.text, 70), heading: clean(g.heading, 24), icon: g.icon as EditGraphic['icon'] } : {}),
    };
    const stripped = Object.fromEntries(Object.entries(graphic).filter(([, v]) => v !== undefined && !(typeof v === 'number' && !Number.isFinite(v))));
    // Same validation as the editor's saves (with a placeholder time).
    if (graphicSchema.safeParse({ ...stripped, start: 0, end: 2 }).success) moments.push({ sentence, graphic: stripped as Moment['graphic'] });
  }
  return moments;
}

/** Turns moments into timed graphics: on kept speech, at most one every 5 s, away from the hook and B-roll. */
export function scheduleGraphics(moments: Moment[], sentences: Sentence[], opts: { segments: Interval[]; avoid: Interval[]; max: number; color?: string }): EditGraphic[] {
  const out: EditGraphic[] = [];
  let last = -Infinity;
  for (const m of [...moments].sort((a, b) => a.sentence - b.sentence)) {
    const s = sentences[m.sentence];
    if (!s) continue;
    // The first moment in the sentence that is kept and clear of the hook / B-roll.
    let start = r2(s.start + 0.1);
    for (let guard = 0; guard < 20; guard++) {
      if (toOutputTime(opts.segments, start) === null) {
        const seg = opts.segments.find((g) => g.start > start);
        if (!seg) break;
        start = r2(seg.start + 0.05);
        continue;
      }
      const block = opts.avoid.find((a) => start < a.end && a.start < start + 1.2);
      if (block) {
        start = r2(block.end + 0.1);
        continue;
      }
      break;
    }
    const end = r2(Math.max(start + 1.2, Math.min(s.end + 0.4, start + SHOW_SEC)));
    if (start > s.end - 0.6 || start - last < 5 || toOutputTime(opts.segments, start) === null || opts.avoid.some((a) => start < a.end && a.start < end)) continue;
    out.push({ ...m.graphic, start, end, ...(opts.color ? { color: opts.color } : {}) });
    last = start;
    if (out.length >= opts.max) break;
  }
  return out;
}

export const maxGraphics = (durationSec: number) => Math.max(1, Math.min(12, Math.floor(durationSec / 8)));

export async function planGraphics(opts: {
  sentences: Sentence[];
  durationSec: number;
  language: string;
  segments: Interval[];
  avoid: Interval[];
  color?: string;
  llm: LLMProvider | null;
  signal?: AbortSignal;
}): Promise<{ graphics: EditGraphic[]; plannedWith: 'ai' | 'rules' }> {
  const max = maxGraphics(opts.durationSec);
  let moments: Moment[] | null = null;
  if (opts.llm && opts.sentences.length > 1) {
    const limit = AbortSignal.timeout(GRAPHICS_AI_TIMEOUT_MS);
    try {
      moments = await aiMoments(opts.llm, opts.sentences, { language: opts.language, max }, opts.signal ? AbortSignal.any([opts.signal, limit]) : limit);
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      logger.warn({ err }, 'AI graphics failed or were slow; using word rules');
    }
  }
  const plannedWith = moments ? 'ai' : 'rules';
  const graphics = scheduleGraphics(moments ?? ruleMoments(opts.sentences), opts.sentences, { segments: opts.segments, avoid: opts.avoid, max, color: opts.color });
  return { graphics, plannedWith };
}

/* ── Export: each graphic rendered with transparency ── */

export interface GraphicRenderJob {
  graphic: Omit<EditGraphic, 'start' | 'end'> & { color: string };
  durationSec: number;
  output: string;
}
/** Renders graphics to transparent clips (ProRes 4444 .mov). Swappable for tests. */
export type GraphicsRenderer = (jobs: GraphicRenderJob[], size: { width: number; height: number }, signal?: AbortSignal) => Promise<void>;

/** Remotion in headless Chrome: one browser for all the graphics of a video. */
export const remotionGraphicsRenderer: GraphicsRenderer = async (jobs, size, signal) => {
  if (!jobs.length) return;
  const { renderMedia, selectComposition, openBrowser, makeCancelSignal } = await import('@remotion/renderer');
  const url = await motionServeUrl();
  const browser = await openBrowser('chrome');
  const { cancelSignal, cancel } = makeCancelSignal();
  const onAbort = () => cancel();
  signal?.addEventListener('abort', onAbort, { once: true });
  // A stuck browser must never hold an export: give up after 60 s + 20 s per graphic (normally ~4 s each).
  const limit = setTimeout(onAbort, 60_000 + jobs.length * 20_000);
  try {
    for (const j of jobs) {
      const inputProps = { graphic: j.graphic, width: size.width, height: size.height, durationInFrames: Math.max(1, Math.round(j.durationSec * MOTION_FPS)) };
      const composition = await selectComposition({ serveUrl: url, id: 'GraphicClip', inputProps, puppeteerInstance: browser });
      await renderMedia({
        composition,
        serveUrl: url,
        inputProps,
        codec: 'prores',
        proResProfile: '4444',
        imageFormat: 'png',
        pixelFormat: 'yuva444p10le',
        outputLocation: j.output,
        muted: true,
        puppeteerInstance: browser,
        concurrency: env.motion.concurrency ?? null,
        cancelSignal,
      });
    }
  } finally {
    clearTimeout(limit);
    signal?.removeEventListener('abort', onAbort);
    await browser.close({ silent: true }).catch(() => undefined);
  }
};

let override: GraphicsRenderer | undefined;
/** Test seam: replace the graphics renderer (undefined = real Remotion). */
export function setGraphicsRenderer(r: GraphicsRenderer | undefined) {
  override = r;
}
export const getGraphicsRenderer = (): GraphicsRenderer => override ?? remotionGraphicsRenderer;

export const graphicClipPath = (workDir: string, i: number) => path.join(workDir, `graphic-${i}.mov`);
