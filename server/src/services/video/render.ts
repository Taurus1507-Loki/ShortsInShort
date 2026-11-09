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
  /** crop = fill the frame (edges cut); blur = whole video over a blurred copy. Default crop. */
  framing?: 'crop' | 'blur';
  /** Stock clips shown full-frame at [start, end] seconds of the edited timeline. */
  broll?: Array<{ path: string; start: number; end: number }>;
  /** Punch-in zooms (scale > 1) at [start, end] seconds of the edited timeline. */
  zooms?: Array<{ start: number; end: number; scale: number }>;
  /** Brand logo image overlaid in a corner for the whole video. */
  logo?: { path: string; position: LogoPosition; widthFrac: number; opacity: number };
  /** Separate ASS file (e.g. Free-plan watermark) burned in last. */
  watermark?: { assPath: string; fontsDir: string };
  /** Background music, looped to length, ducked under speech, faded out at the end. */
  music?: { path: string; volume: number; duck: boolean };
}

export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** FFmpeg expression for the zoom factor at time t (1 = no zoom). Exported for tests. */
export function zoomExpr(zooms: Array<{ start: number; end: number; scale: number }>): string {
  if (!zooms.length) return '1';
  return `1+${zooms.map((z) => `between(t,${z.start.toFixed(3)},${z.end.toFixed(3)})*${(z.scale - 1).toFixed(3)}`).join('+')}`;
}

const LOGO_XY: Record<LogoPosition, string> = {
  'top-left': 'x=W*0.04:y=H*0.04',
  'top-right': 'x=W-w-W*0.04:y=H*0.04',
  'bottom-left': 'x=W*0.04:y=H-h-H*0.04',
  'bottom-right': 'x=W-w-W*0.04:y=H-h-H*0.04',
};

/**
 * Resolves the user's framing choice for a given source. "auto" keeps the crop when the shapes are
 * close (little is lost) and switches to a blurred background when they differ a lot, e.g. landscape
 * footage into a vertical Reel, where cropping would cut off most of the picture.
 */
export function resolveFraming(setting: 'auto' | 'crop' | 'blur', source: { width: number; height: number }, aspect: AspectRatio): 'crop' | 'blur' {
  if (setting !== 'auto') return setting;
  const [aw, ah] = aspect.split(':').map(Number) as [number, number];
  const ratio = source.width / source.height / (aw / ah);
  // > 1.5× different (e.g. 16:9 → 9:16 is 3.2×) loses too much picture to crop; 4:5 → 9:16 (1.4×) crops fine.
  return Math.max(ratio, 1 / ratio) > 1.5 ? 'blur' : 'crop';
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
  const duration = totalDuration(r.segments);

  const pre = [`fps=${fps}`, ...(cutting ? [`select='${sel}'`, 'setpts=N/FRAME_RATE/TB'] : [])].join(',');
  const graph: string[] = [];
  let cur = 'base0';
  const next = (label: string) => {
    cur = label;
    return label;
  };

  // 1. Reframe to the target shape.
  if ((r.framing ?? 'crop') === 'blur') {
    // Whole video, centred, over a blurred + darkened copy of itself. The background is blurred at
    // quarter size and scaled back up — visually identical to a full-size blur, ~16× cheaper.
    const bw = even(width / 4);
    const bh = even(height / 4);
    graph.push(
      `[0:v:0]${pre},split=2[bgsrc][fgsrc]`,
      `[bgsrc]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=luma_radius=12:luma_power=2,eq=brightness=-0.08:saturation=1.1,scale=${width}:${height}[bg]`,
      `[fgsrc]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[base0]`,
    );
  } else {
    graph.push(`[0:v:0]${pre},scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}[base0]`);
  }

  // 2. Punch-in zooms on the speaker (centre zoom, frame size unchanged).
  if (r.zooms?.length) {
    const z = zoomExpr(r.zooms);
    graph.push(
      `[${cur}]scale=w='trunc(iw*(${z})/2)*2':h='trunc(ih*(${z})/2)*2':eval=frame:flags=bicubic,crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2[${next('zoomed')}]`,
    );
  }

  // 3. B-roll cutaways: each clip fills the frame during its slot on the EDITED timeline while the
  //    speaker's audio continues underneath. Hard cuts, as is standard for short-form.
  const broll = r.broll ?? [];
  let input = 1;
  broll.forEach((b, i) => {
    const d = Math.max(0.1, b.end - b.start);
    const from = cur;
    graph.push(
      `[${input}:v:0]trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS+${b.start.toFixed(3)}/TB,fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[b${i}]`,
      `[${from}][b${i}]overlay=enable='between(t,${b.start.toFixed(3)},${b.end.toFixed(3)})':eof_action=pass[${next(`base${i + 1}`)}]`,
    );
    input++;
  });

  // 4. Brand logo in a corner (above B-roll, below captions).
  const logoInput = r.logo ? input++ : -1;
  if (r.logo) {
    const lw = even(width * r.logo.widthFrac);
    const from = cur;
    graph.push(
      `[${logoInput}:v:0]scale=${lw}:-1,format=rgba,colorchannelmixer=aa=${r.logo.opacity.toFixed(2)}[logo]`,
      `[${from}][logo]overlay=${LOGO_XY[r.logo.position]}:format=auto[${next('branded')}]`,
    );
  }

  // 5. Captions, then the watermark, always on top.
  const post = [
    'setsar=1',
    ...(r.captions ? [`ass=filename=${filterPath(r.captions.assPath)}:fontsdir=${filterPath(r.captions.fontsDir)}`] : []),
    ...(r.watermark ? [`ass=filename=${filterPath(r.watermark.assPath)}:fontsdir=${filterPath(r.watermark.fontsDir)}`] : []),
    'format=yuv420p',
  ].join(',');
  graph.push(`[${cur}]${post}[v]`);

  // Audio: speech (cut to match) → optional music bed, ducked under speech → loudness normalised.
  const musicInput = r.music ? input++ : -1;
  const loud = 'loudnorm=I=-14:TP=-1.5:LRA=11';
  const voice = [...(cutting ? [`aselect='${sel}'`, 'asetpts=N/SR/TB'] : []), 'aresample=48000'].join(',');
  if (r.music) {
    // Fade out over the last 1.5 s (shorter on very short videos).
    const fadeDur = Math.min(1.5, duration * 0.25);
    const fadeAt = Math.max(0, duration - fadeDur);
    const mus = `[${musicInput}:a:0]atrim=duration=${duration.toFixed(3)},asetpts=N/SR/TB,aresample=48000,volume=${r.music.volume.toFixed(2)},afade=t=out:st=${fadeAt.toFixed(3)}:d=${fadeDur.toFixed(3)}[mus]`;
    if (r.hasAudio && r.music.duck) {
      graph.push(
        `[0:a:0]${voice},asplit=2[vo][sc]`,
        mus,
        // Music dips automatically whenever the speaker talks.
        `[mus][sc]sidechaincompress=threshold=0.05:ratio=3:attack=20:release=350[ducked]`,
        `[vo][ducked]amix=inputs=2:duration=first:normalize=0,${loud}[a]`,
      );
    } else if (r.hasAudio) {
      graph.push(`[0:a:0]${voice}[vo]`, mus, `[vo][mus]amix=inputs=2:duration=first:normalize=0,${loud}[a]`);
    } else {
      graph.push(mus.replace('[mus]', `,${loud}[a]`));
    }
  } else if (r.hasAudio) {
    graph.push(`[0:a:0]${voice},${loud}[a]`);
  }
  const hasAudioOut = r.hasAudio || Boolean(r.music);

  return [
    '-i', r.input,
    ...broll.flatMap((b) => ['-i', b.path]),
    ...(r.logo ? ['-i', r.logo.path] : []),
    ...(r.music ? ['-stream_loop', '-1', '-i', r.music.path] : []),
    '-filter_complex', graph.join(';'),
    '-map', '[v]',
    ...(hasAudioOut ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000'] : ['-an']),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', r.resolution === '4k' ? '23' : '21',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-movflags', '+faststart',
    '-t', String(duration + 0.1),
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
