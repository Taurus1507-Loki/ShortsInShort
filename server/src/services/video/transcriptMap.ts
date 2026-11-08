import type { Word } from '../ai/transcription.js';
import type { Interval } from './silence.js';

/**
 * Turns filler words ("um", "uh") into intervals to cut, so they are removed together with pauses.
 * Fillers shorter than `minSec` are ignored (cutting them causes audible clicks for no gain).
 */
export function fillerIntervals(words: Word[], opts: { padSec?: number; minSec?: number } = {}): Interval[] {
  const pad = opts.padSec ?? 0.03;
  const min = opts.minSec ?? 0.12;
  return words
    .filter((w) => w.filler && w.end - w.start >= min)
    .map((w) => ({ start: round3(Math.max(0, w.start - pad)), end: round3(w.end + pad) }));
}

/** Merges overlapping intervals (inputs may come from silencedetect and from fillers). */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/**
 * Re-times words onto the edited timeline. A word is kept when most of it survives the cut; its
 * times are shifted by the duration removed before it and clipped to its segment. Fillers are dropped.
 */
export function remapWords(words: Word[], segments: Interval[]): Word[] {
  const out: Word[] = [];
  let offset = 0; // edited-timeline start of the current segment
  const starts = segments.map((s) => {
    const o = offset;
    offset += s.end - s.start;
    return o;
  });

  for (const w of words) {
    if (w.filler) continue;
    const dur = Math.max(0.001, w.end - w.start);
    let best = -1;
    let bestOverlap = 0;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]!;
      const overlap = Math.min(w.end, s.end) - Math.max(w.start, s.start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = i;
      }
    }
    // Keep a word if most of it survives, or if enough of it remains to be heard: ASR timestamps
    // often stretch a word over a preceding pause/filler that was cut (e.g. "um, every" → "every").
    if (best < 0 || (bestOverlap / dur < 0.5 && bestOverlap < 0.2)) continue;
    const s = segments[best]!;
    const base = starts[best]!;
    const start = base + Math.max(w.start, s.start) - s.start;
    const end = base + Math.min(w.end, s.end) - s.start;
    out.push({ ...w, start: round3(start), end: round3(Math.max(end, start + 0.05)) });
  }
  return out;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
