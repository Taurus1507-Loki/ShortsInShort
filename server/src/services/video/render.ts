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

export async function extractThumbnail(input: string, output: string, atSec: number, opts: RunOptions = {}) {
  await runFfmpeg(['-ss', String(Math.max(0, atSec)), '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '3', output], {
    timeoutMs: 60_000,
    ...opts,
  });
}
