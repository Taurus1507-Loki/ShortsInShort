import { z } from 'zod';
import type { Interval } from './silence.js';

/**
 * AI Video Editor timeline ("edit decision list"). All times are seconds on the SOURCE footage, so
 * zooms and text stay attached to the right moment when cuts change. The web editor computes
 * `segments` (what to keep) with the same rule as `keepSegments` below and saves them; the export
 * renders exactly those segments.
 */
export interface EditZoom {
  at: number;
  dur: number;
  scale: number;
}
export type TextStyle = 'outline' | 'box' | 'accent';
export interface EditText {
  start: number;
  end: number;
  text: string;
  position: 'top' | 'middle' | 'bottom';
  /** outline = white with a black edge; box = on a dark box; accent = on a coloured box. */
  style?: TextStyle;
  size?: 's' | 'm' | 'l';
  /** Text colour (outline) or box colour (accent). */
  color?: string;
}
/** One caption line, word-timed on the SOURCE footage; keyword = index of the highlighted word (-1 none). */
export interface EditCaption {
  words: Array<{ text: string; start: number; end: number }>;
  keyword: number;
}
/** A stock clip the server found for this project (download link kept server-side only). */
export interface PoolClip {
  id: string;
  provider: string;
  downloadUrl: string;
  pageUrl: string;
  author: string;
  thumbnailUrl: string | null;
  durationSec: number;
  width: number;
  height: number;
}
/** A B-roll cutaway on the SOURCE timeline: the clip shown, and the other options found for it. */
export interface EditBroll {
  start: number;
  end: number;
  query: string;
  clipId: string;
  candidateIds: string[];
}
/** Background music: auto = picked from the project's mood; none; or a chosen library track. */
export interface EditMusic {
  mode: 'auto' | 'none' | 'track';
  file?: string;
  /** 0–1 (0.25 ≈ a mastered track about 8 dB under speech). */
  volume: number;
  /** Dip the music while someone speaks. */
  duck: boolean;
}

export interface EditDoc {
  sourceAssetId: string;
  analyzedAt: string;
  durationSec: number;
  /** Pauses detected at 0.3 s and longer (the "remove pauses" setting picks from these). */
  silences: Interval[];
  /** Filler words ("um", "uh"…). */
  fillers: Interval[];
  /** Remove pauses at least this long (0 = keep pauses). */
  pauseSec: 0 | 0.3 | 0.6 | 1;
  removeFillers: boolean;
  /** Ranges the user cut, and ranges they brought back (override automatic cuts). */
  cuts: Interval[];
  restores: Interval[];
  zooms: EditZoom[];
  texts: EditText[];
  /** Caption lines (laid out at analysis, then edited by the user). Null = none yet. */
  captions?: EditCaption[] | null;
  broll?: EditBroll[];
  /** Every clip offered for this project, by id (server-side: holds the download links). */
  brollPool?: Record<string, PoolClip>;
  music?: EditMusic | null;
  /** What the export keeps, in order. Empty until the editor first saves (then `keepSegments` decides). */
  segments: Interval[];
}

export const PAUSE_OPTIONS = [0, 0.3, 0.6, 1] as const;
/** Padding kept around speech when a pause is cut, so words aren't clipped. */
export const PAD_SEC = 0.12;
const MIN_KEEP = 0.2;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function mergeRanges(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).map((i) => ({ ...i })).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end + 0.001) last.end = Math.max(last.end, i.end);
    else out.push(i);
  }
  return out;
}

/** `a` minus `b` (both merged lists). */
export function subtractRanges(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    let pieces = [{ ...x }];
    for (const y of b) {
      pieces = pieces.flatMap((p) => {
        if (y.end <= p.start || y.start >= p.end) return [p];
        const rest: Interval[] = [];
        if (y.start > p.start) rest.push({ start: p.start, end: y.start });
        if (y.end < p.end) rest.push({ start: y.end, end: p.end });
        return rest;
      });
    }
    out.push(...pieces);
  }
  return out;
}

/** The ranges the edit removes: long-enough pauses (padded), fillers, manual cuts, minus restores. */
export function removedRanges(e: Pick<EditDoc, 'durationSec' | 'silences' | 'fillers' | 'pauseSec' | 'removeFillers' | 'cuts' | 'restores'>): Interval[] {
  const auto: Interval[] = [];
  if (e.pauseSec > 0) {
    for (const s of e.silences) {
      if (s.end - s.start < e.pauseSec) continue;
      // Keep a little air around speech; a pause at the very start/end is removed entirely.
      const start = s.start <= 0.01 ? 0 : s.start + PAD_SEC;
      const end = s.end >= e.durationSec - 0.01 ? e.durationSec : s.end - PAD_SEC;
      if (end - start > 0.05) auto.push({ start, end });
    }
  }
  if (e.removeFillers) auto.push(...e.fillers);
  const removed = mergeRanges([...auto, ...e.cuts]);
  return subtractRanges(removed, mergeRanges(e.restores));
}

/** What to keep, in order (slivers shorter than 0.2 s are dropped). */
export function keepSegments(e: Parameters<typeof removedRanges>[0]): Interval[] {
  const keep = subtractRanges([{ start: 0, end: e.durationSec }], mergeRanges(removedRanges(e)));
  return keep.filter((k) => k.end - k.start >= MIN_KEEP).map((k) => ({ start: r3(k.start), end: r3(k.end) }));
}

/** Source time → time in the edited video, or null when that moment was cut. */
export function toOutputTime(segments: Interval[], t: number): number | null {
  let offset = 0;
  for (const s of segments) {
    if (t >= s.start && t <= s.end) return offset + (t - s.start);
    offset += s.end - s.start;
  }
  return null;
}

/**
 * A source range on the edited timeline: the kept part from its first surviving moment, as one
 * continuous output range (cut gaps inside it shrink it). Null when it was cut entirely.
 */
export function rangeToOutput(segments: Interval[], start: number, end: number): Interval | null {
  let offset = 0;
  let outStart: number | null = null;
  let outEnd: number | null = null;
  for (const s of segments) {
    const a = Math.max(start, s.start);
    const b = Math.min(end, s.end);
    if (b > a) {
      if (outStart === null) outStart = offset + (a - s.start);
      outEnd = offset + (b - s.start);
    }
    offset += s.end - s.start;
  }
  return outStart !== null && outEnd !== null && outEnd > outStart ? { start: r3(outStart), end: r3(outEnd) } : null;
}

/** First analysis of a source: sensible defaults (cut pauses of 0.6 s+ and filler words). */
export function initialEdit(sourceAssetId: string, durationSec: number, silences: Interval[], fillers: Interval[], previous?: EditDoc | null): EditDoc {
  // Re-analysing the same footage keeps the user's own edits.
  const keepUser = previous && previous.sourceAssetId === sourceAssetId;
  return {
    sourceAssetId,
    analyzedAt: new Date().toISOString(),
    durationSec: r3(durationSec),
    silences: silences.map((s) => ({ start: r3(s.start), end: r3(s.end) })),
    fillers: fillers.map((s) => ({ start: r3(s.start), end: r3(s.end) })),
    pauseSec: keepUser ? previous.pauseSec : 0.6,
    removeFillers: keepUser ? previous.removeFillers : true,
    cuts: keepUser ? previous.cuts : [],
    restores: keepUser ? previous.restores : [],
    zooms: keepUser ? previous.zooms : [],
    texts: keepUser ? previous.texts : [],
    captions: keepUser ? (previous.captions ?? null) : null,
    broll: keepUser ? (previous.broll ?? []) : [],
    brollPool: keepUser ? (previous.brollPool ?? {}) : {},
    music: keepUser ? (previous.music ?? null) : null,
    segments: keepUser ? previous.segments : [],
  };
}

/* ── Validation of edits sent by the web editor ── */

const interval = z.object({ start: z.number().min(0), end: z.number().positive() }).strict().refine((i) => i.end > i.start, 'A range must end after it starts.');
export const editPatchSchema = z
  .object({
    pauseSec: z.union([z.literal(0), z.literal(0.3), z.literal(0.6), z.literal(1)]),
    removeFillers: z.boolean(),
    cuts: z.array(interval).max(500),
    restores: z.array(interval).max(500),
    zooms: z.array(z.object({ at: z.number().min(0), dur: z.number().min(0.3).max(6), scale: z.number().min(1.02).max(1.5) }).strict()).max(200),
    texts: z
      .array(
        z
          .object({
            start: z.number().min(0),
            end: z.number().positive(),
            text: z.string().trim().min(1).max(80),
            position: z.enum(['top', 'middle', 'bottom']),
            style: z.enum(['outline', 'box', 'accent']).optional(),
            size: z.enum(['s', 'm', 'l']).optional(),
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
          })
          .strict()
          .refine((t) => t.end > t.start, 'Text must end after it starts.'),
      )
      .max(50),
    captions: z
      .array(
        z
          .object({
            words: z.array(z.object({ text: z.string().trim().min(1).max(40), start: z.number().min(0), end: z.number().positive() }).strict()).min(1).max(20),
            keyword: z.number().int().min(-1).max(19),
          })
          .strict(),
      )
      .max(2000)
      .nullable(),
    broll: z
      .array(
        z
          .object({ start: z.number().min(0), end: z.number().positive(), query: z.string().trim().max(80), clipId: z.string().min(1).max(64), candidateIds: z.array(z.string().min(1).max(64)).max(12) })
          .strict()
          .refine((b) => b.end - b.start >= 0.5 && b.end - b.start <= 12, 'A B-roll clip is shown for 0.5–12 seconds.'),
      )
      .max(60),
    music: z
      .object({ mode: z.enum(['auto', 'none', 'track']), file: z.string().regex(/^[a-z0-9-]+\.mp3$/).optional(), volume: z.number().min(0).max(1), duck: z.boolean() })
      .strict()
      .refine((m) => m.mode !== 'track' || Boolean(m.file), 'Choose a track.')
      .nullable(),
    segments: z.array(interval).max(400),
  })
  .strict()
  .partial();

/** Checks saved segments fit the footage and are in order without overlaps. Returns an error or null. */
export function segmentsProblem(segments: Interval[], durationSec: number): string | null {
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    if (s.end > durationSec + 0.05) return `Segment ${i + 1} runs past the end of the video.`;
    if (s.end - s.start < 0.1) return `Segment ${i + 1} is too short.`;
    if (i > 0 && s.start < segments[i - 1]!.end - 0.001) return `Segment ${i + 1} overlaps the one before it.`;
  }
  return null;
}

/** Caption lines on the edited timeline: cut words are dropped, the rest keep their place (export and preview). */
export function captionsToOutput(captions: EditCaption[], segments: Interval[]) {
  const out: Array<{ words: Array<{ text: string; start: number; end: number }>; start: number; end: number; keywords: number[] }> = [];
  for (const c of captions) {
    const words: Array<{ text: string; start: number; end: number }> = [];
    let keyword = -1;
    c.words.forEach((w, i) => {
      const r = rangeToOutput(segments, w.start, w.end);
      if (!r || r.end - r.start < (w.end - w.start) * 0.5) return;
      if (i === c.keyword) keyword = words.length;
      words.push({ text: w.text, start: r.start, end: r.end });
    });
    if (words.length) out.push({ words, start: words[0]!.start, end: words[words.length - 1]!.end, keywords: keyword >= 0 ? [keyword] : [] });
  }
  return out;
}

/** The edit as sent to the browser: clip download links stay on the server. */
export function publicEdit(e: EditDoc | null | undefined) {
  if (!e) return null;
  const pool = Object.fromEntries(Object.entries(e.brollPool ?? {}).map(([id, c]) => [id, { id: c.id, provider: c.provider, pageUrl: c.pageUrl, author: c.author, thumbnailUrl: c.thumbnailUrl, durationSec: c.durationSec, width: c.width, height: c.height }]));
  return { ...e, brollPool: pool };
}
