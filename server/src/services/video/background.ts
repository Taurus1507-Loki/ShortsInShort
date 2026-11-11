import { runFfmpeg, type RunOptions } from './ffmpeg.js';

export type BackgroundKind = 'brand' | 'color' | 'image' | 'video';

export interface BackgroundInput {
  kind: BackgroundKind;
  width: number;
  height: number;
  durationSec: number;
  /** Narration audio laid under the background. */
  audioPath: string;
  output: string;
  /** brand: two colours for a slowly moving gradient; color: the first is used. */
  colors?: [string, string];
  /** image/video file for those kinds. */
  mediaPath?: string;
  fps?: number;
  /** Talking presenter clip (green background). full = fills the frame; overlay = keyed over the background. */
  presenter?: { path: string; layout: 'full' | 'overlay'; keyColor: string };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const hex = (c: string) => `0x${c.replace('#', '').toUpperCase()}`;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * FFmpeg arguments for the base video of a voiceover project: a background at the final size with
 * the narration as its audio. Image backgrounds slowly pan; video backgrounds loop silently; both are
 * darkened slightly so captions stay readable. Exported for tests.
 */
export function buildBackgroundArgs(b: BackgroundInput): string[] {
  const fps = b.fps ?? 30;
  const d = Math.max(0.5, b.durationSec).toFixed(3);
  const W = b.width;
  const H = b.height;
  const [c0, c1] = (b.colors ?? ['#4C1D95', '#0F172A']).map((c) => (HEX_RE.test(c) ? c : '#1E1B4B')) as [string, string];
  const input: string[] = [];
  let vf: string;
  switch (b.kind) {
    case 'brand':
      // A diagonal two-colour gradient that drifts slowly — motion without distraction.
      input.push('-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=${hex(c0)}:c1=${hex(c1)}:x0=0:y0=0:x1=${W}:y1=${H}:nb_colors=2:speed=0.00005:r=${fps}:d=${d}`);
      vf = 'format=yuv420p';
      break;
    case 'color':
      input.push('-f', 'lavfi', '-i', `color=c=${hex(c0)}:s=${W}x${H}:r=${fps}:d=${d}`);
      vf = 'format=yuv420p';
      break;
    case 'image': {
      if (!b.mediaPath) throw new Error('Image background needs a file.');
      // Cover a frame 12% larger, then pan across it over the whole video.
      const bw = even(W * 1.12);
      const bh = even(H * 1.12);
      input.push('-loop', '1', '-framerate', String(fps), '-t', d, '-i', b.mediaPath);
      vf = `scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},crop=${W}:${H}:x='(iw-ow)*t/${d}':y='(ih-oh)/2',eq=brightness=-0.05,format=yuv420p`;
      break;
    }
    case 'video':
      if (!b.mediaPath) throw new Error('Video background needs a file.');
      input.push('-stream_loop', '-1', '-i', b.mediaPath);
      vf = `fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},eq=brightness=-0.05,format=yuv420p`;
      break;
  }
  const out = ['-t', d, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', String(fps), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', b.output];
  if (b.presenter?.layout === 'full') {
    // The provider already rendered the presenter on a solid colour at this aspect ratio.
    return [
      '-i', b.presenter.path,
      '-i', b.audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-vf', `fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=yuv420p,tpad=stop_mode=clone:stop_duration=2`,
      ...out,
    ];
  }
  if (b.presenter?.layout === 'overlay') {
    // Key out the solid background and stand the presenter at the bottom, ~78% of the frame tall.
    const ph = even(H * 0.78);
    return [
      ...input,
      '-i', b.presenter.path,
      '-i', b.audioPath,
      '-filter_complex',
      `[0:v]${vf}[bg];[1:v]fps=${fps},chromakey=${hex(b.presenter.keyColor)}:0.13:0.07,scale=-2:${ph},tpad=stop_mode=clone:stop_duration=2[p];[bg][p]overlay=(W-w)/2:H-h:eof_action=repeat,format=yuv420p[v]`,
      '-map', '[v]', '-map', '2:a:0',
      ...out,
    ];
  }
  return [
    ...input,
    '-i', b.audioPath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-vf', vf,
    '-t', d,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    b.output,
  ];
}

export async function renderBackground(b: BackgroundInput, opts: RunOptions = {}) {
  await runFfmpeg(buildBackgroundArgs(b), { timeoutMs: Math.max(120_000, b.durationSec * 8000), ...opts });
}

export interface ScenesInput {
  width: number;
  height: number;
  /** Clips (or still images) in order with the seconds each must fill (from the voiceover timings). */
  scenes: Array<{ path: string; durationSec: number; image?: boolean }>;
  audioPath: string;
  output: string;
  fps?: number;
}

/**
 * FFmpeg arguments for a faceless video's base clip: each scene's stock clip is looped if short,
 * cut to its scene length, scaled to fill the frame, then all are joined and laid under the
 * voiceover. Exported for tests.
 */
export function buildScenesArgs(s: ScenesInput): string[] {
  const fps = s.fps ?? 30;
  const W = s.width;
  const H = s.height;
  const inputs: string[] = [];
  const chains: string[] = [];
  s.scenes.forEach((sc, i) => {
    const d = Math.max(0.3, sc.durationSec).toFixed(3);
    if (sc.image) {
      // Stills get gentle motion: cover a 10% larger frame and pan across it (alternating direction).
      const bw = even(W * 1.1);
      const bh = even(H * 1.1);
      const x = i % 2 === 0 ? `(iw-ow)*t/${d}` : `(iw-ow)*(1-t/${d})`;
      inputs.push('-loop', '1', '-framerate', String(fps), '-t', d, '-i', sc.path);
      chains.push(`[${i}:v]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},crop=${W}:${H}:x='${x}':y='(ih-oh)/2',setsar=1,trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`);
      return;
    }
    inputs.push('-stream_loop', '-1', '-t', d, '-i', sc.path);
    chains.push(`[${i}:v]fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`);
  });
  const n = s.scenes.length;
  const total = s.scenes.reduce((t, sc) => t + Math.max(0.3, sc.durationSec), 0).toFixed(3);
  return [
    ...inputs,
    '-i', s.audioPath,
    '-filter_complex', `${chains.join(';')};${s.scenes.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0,format=yuv420p[v]`,
    '-map', '[v]', '-map', `${n}:a:0`,
    '-t', total,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    s.output,
  ];
}

export async function renderScenes(s: ScenesInput, opts: RunOptions = {}) {
  const total = s.scenes.reduce((t, sc) => t + sc.durationSec, 0);
  await runFfmpeg(buildScenesArgs(s), { timeoutMs: Math.max(180_000, total * 12_000), ...opts });
}
