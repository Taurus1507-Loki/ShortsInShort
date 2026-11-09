import type { CaptionLine } from './captions.js';
import type { Interval } from './silence.js';

export type ZoomIntensity = 'off' | 'subtle' | 'dynamic';

const SPEC: Record<Exclude<ZoomIntensity, 'off'>, { scale: number; everyNthLine: number; periodicSec: number }> = {
  subtle: { scale: 1.08, everyNthLine: 3, periodicSec: 6 },
  dynamic: { scale: 1.15, everyNthLine: 2, periodicSec: 4 },
};

export interface Zoom {
  start: number;
  end: number;
  scale: number;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/**
 * Plans punch-in zooms. With captions, zoom on every Nth line — preferring lines that carry a
 * highlighted keyword — so the zoom lands on emphasis. Without a transcript, fall back to a steady
 * rhythm. Zooms never overlap B-roll (the speaker isn't on screen then) and last at most 2.5 s.
 */
export function planZooms(opts: { intensity: ZoomIntensity; durationSec: number; lines?: CaptionLine[]; avoid?: Interval[] }): Zoom[] {
  if (opts.intensity === 'off') return [];
  const spec = SPEC[opts.intensity];
  const avoid = opts.avoid ?? [];
  const out: Zoom[] = [];
  const push = (start: number, end: number) => {
    const z = { start: round3(start), end: round3(Math.min(end, start + 2.5, opts.durationSec)), scale: spec.scale };
    if (z.end - z.start < 0.6) return;
    if (avoid.some((a) => overlaps(a, z))) return;
    const last = out[out.length - 1];
    if (last && z.start < last.end + 0.8) return;
    out.push(z);
  };

  if (opts.lines?.length) {
    // Walk the lines in groups of N; within each group pick a line with a keyword if there is one.
    for (let g = 0; g < opts.lines.length; g += spec.everyNthLine) {
      const group = opts.lines.slice(g, g + spec.everyNthLine);
      if (g === 0) group.shift(); // let the opening line breathe
      const pick = group.find((l) => l.keywords.length) ?? group[group.length - 1];
      if (pick) push(pick.start, pick.end);
    }
  } else {
    for (let t = spec.periodicSec / 2; t < opts.durationSec - 1; t += spec.periodicSec) push(t, t + 2);
  }
  return out;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
