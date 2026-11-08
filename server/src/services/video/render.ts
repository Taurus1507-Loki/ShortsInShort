import { runFfmpeg, type RunOptions } from './ffmpeg.js';
import { totalDuration, type Interval } from './silence.js';

export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:5';
export type Resolution = '720p' | '1080p' | '4k';

const SHORT_SIDE: Record<Resolution, number> = { '720p': 720, '1080p': 1080, '4k': 2160 };

/** Output frame size for a platform aspect ratio at a given resolution (even dimensions). */
export function outputSize(aspect: AspectRatio, res: Resolution): { width: number; height: number } {
  const s = SHORT_SIDE[res];
  const [w, h] = aspect.split(':').map(Number) as [number, number];
  const even = (n: number) => Math.round(n / 2) * 2;
  return w >= h ? { width: even((s * w) / h), height: s } : { width: s, height: even((s * h) / w) };
}

export interface RenderInput {
  input: string;
  output: string;
  segments: Interval[];
  sourceDurationSec: number;
  hasAudio: boolean;
  aspect: AspectRatio;
  resolution: Resolution;
  fps?: number;
  /** ASS subtitle file to burn in (already timed to the edited timeline). */
  captions?: { assPath: string; fontsDir: string };
}

/**
 * Quotes a filesystem path for use as an FFmpeg filter option value. Backslashes become forward
 * slashes and `:`/`'` are escaped, so Windows drive letters (C:) survive filtergraph parsing.
 */
export function filterPath(p: string): string {
  return `'${p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")}'`;
}

const selectExpr = (segs: Interval[]) => segs.map((s) => `between(t,${s.start},${s.end})`).join('+');

/**
 * Builds the FFmpeg arguments for the core edit:
 * cut to kept segments (frame-accurate select/aselect + timestamp rebuild) → reframe to the target
 * aspect ratio (scale-to-cover + centre crop) → loudness-normalise audio for social platforms
 * (−14 LUFS) → H.264/AAC MP4 with faststart for streaming.
 */
export function buildRenderArgs(r: RenderInput): string[] {
  const { width, height } = outputSize(r.aspect, r.resolution);
  const fps = r.fps ?? 30;
  const cutting = !(r.segments.length === 1 && r.segments[0]!.start <= 0.001 && r.segments[0]!.end >= r.sourceDurationSec - 0.001);
  const sel = selectExpr(r.segments);

  const v = [
    `fps=${fps}`,
    ...(cutting ? [`select='${sel}'`, 'setpts=N/FRAME_RATE/TB'] : []),
    `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${width}:${height}`,
    'setsar=1',
    // Captions are burned in after reframing so they are laid out for the final frame size.
    ...(r.captions ? [`ass=filename=${filterPath(r.captions.assPath)}:fontsdir=${filterPath(r.captions.fontsDir)}`] : []),
    'format=yuv420p',
  ].join(',');
  const graph = [`[0:v:0]${v}[v]`];
  if (r.hasAudio) {
    const a = [
      ...(cutting ? [`aselect='${sel}'`, 'asetpts=N/SR/TB'] : []),
      'aresample=48000',
      'loudnorm=I=-14:TP=-1.5:LRA=11',
    ].join(',');
    graph.push(`[0:a:0]${a}[a]`);
  }

  return [
    '-i', r.input,
    '-filter_complex', graph.join(';'),
    '-map', '[v]',
    ...(r.hasAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000'] : ['-an']),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', r.resolution === '4k' ? '23' : '21',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-movflags', '+faststart',
    '-t', String(totalDuration(r.segments) + 0.1),
    '-progress', 'pipe:1',
    '-nostats',
    r.output,
  ];
}

export async function renderVideo(r: RenderInput, opts: RunOptions & { onFraction?: (f: number) => void } = {}) {
  const expected = totalDuration(r.segments);
  await runFfmpeg(buildRenderArgs(r), {
    ...opts,
    onProgress: (t) => opts.onFraction?.(Math.min(1, t / Math.max(expected, 0.1))),
  });
  return { expectedDurationSec: expected };
}

/** Compact mono speech track for transcription (smaller upload, same accuracy). */
export async function extractSpeechAudio(input: string, output: string, opts: RunOptions = {}) {
  await runFfmpeg(['-i', input, '-vn', '-sn', '-dn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', output], {
    timeoutMs: 10 * 60_000,
    ...opts,
  });
}

export async function extractThumbnail(input: string, output: string, atSec: number, opts: RunOptions = {}) {
  await runFfmpeg(['-ss', String(Math.max(0, atSec)), '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '3', output], {
    timeoutMs: 60_000,
    ...opts,
  });
}
