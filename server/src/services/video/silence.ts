import { runFfmpeg, type RunOptions } from './ffmpeg.js';

export interface Interval {
  start: number;
  end: number;
}

export type Intensity = 'low' | 'medium' | 'high';

/** Editing intensity → how aggressively pauses are cut. */
export const SILENCE_PRESETS: Record<Intensity, { noiseDb: number; minSilenceSec: number; padSec: number }> = {
  low: { noiseDb: -38, minSilenceSec: 1.0, padSec: 0.25 },
  medium: { noiseDb: -35, minSilenceSec: 0.6, padSec: 0.15 },
  high: { noiseDb: -32, minSilenceSec: 0.35, padSec: 0.08 },
};

/** Parses FFmpeg `silencedetect` output into intervals. A trailing open silence runs to `duration`. */
export function parseSilences(stderr: string, duration: number): Interval[] {
  const out: Interval[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) {
      open = Math.max(0, Number(s[1]));
      continue;
    }
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && open !== null) {
      out.push({ start: open, end: Math.min(duration, Number(e[1])) });
      open = null;
    }
  }
  if (open !== null && open < duration) out.push({ start: open, end: duration });
  return out.filter((i) => i.end > i.start);
}

export async function detectSilences(input: string, duration: number, intensity: Intensity, opts: RunOptions = {}): Promise<Interval[]> {
  const p = SILENCE_PRESETS[intensity];
  const { stderr } = await runFfmpeg(
    ['-i', input, '-vn', '-sn', '-dn', '-af', `silencedetect=noise=${p.noiseDb}dB:d=${p.minSilenceSec}`, '-f', 'null', '-'],
    opts,
  );
  return parseSilences(stderr, duration);
}

/**
 * Turns silences into the segments to KEEP. Each kept segment is padded so words aren't clipped,
 * overlapping segments are merged, slivers are dropped, and the count is capped so the FFmpeg
 * filter expression stays bounded (closest segments are merged first).
 */
export function computeKeepSegments(
  duration: number,
  silences: Interval[],
  opts: { padSec: number; minKeepSec?: number; maxSegments?: number },
): Interval[] {
  const minKeep = opts.minKeepSec ?? 0.25;
  const maxSegments = opts.maxSegments ?? 250;
  const sorted = [...silences].sort((a, b) => a.start - b.start);

  let keeps: Interval[] = [];
  let cursor = 0;
  for (const s of sorted) {
    if (s.start > cursor) keeps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < duration) keeps.push({ start: cursor, end: duration });

  keeps = keeps
    .map((k) => ({ start: Math.max(0, k.start - opts.padSec), end: Math.min(duration, k.end + opts.padSec) }))
    .filter((k) => k.end - k.start >= minKeep);

  // Merge overlaps / near-touching segments.
  const merged: Interval[] = [];
  for (const k of keeps) {
    const last = merged[merged.length - 1];
    if (last && k.start <= last.end + 0.05) last.end = Math.max(last.end, k.end);
    else merged.push({ ...k });
  }

  // Cap segment count by closing the smallest gaps.
  while (merged.length > maxSegments) {
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < merged.length - 1; i++) {
      const gap = merged[i + 1]!.start - merged[i]!.end;
      if (gap < best) {
        best = gap;
        idx = i;
      }
    }
    merged[idx]!.end = merged[idx + 1]!.end;
    merged.splice(idx + 1, 1);
  }

  // Nothing meaningful left (e.g. a silent clip): keep the whole thing rather than output nothing.
  const kept = merged.reduce((t, k) => t + (k.end - k.start), 0);
  if (merged.length === 0 || kept < 0.5) return [{ start: 0, end: duration }];
  return merged.map((k) => ({ start: round3(k.start), end: round3(k.end) }));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const totalDuration = (segs: Interval[]) => segs.reduce((t, s) => t + (s.end - s.start), 0);
