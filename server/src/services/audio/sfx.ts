import { mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFfmpeg, type RunOptions } from '../video/ffmpeg.js';
import type { MotionScene } from '../faceless/motion.js';

/**
 * Sound effects are synthesised with FFmpeg (no third-party samples, so nothing to license).
 * Each is a short mono 44.1 kHz WAV, generated once per server and cached on disk.
 */
export const SFX_KINDS = ['whoosh', 'pop', 'tick', 'ding', 'type', 'impact'] as const;
export type SfxKind = (typeof SFX_KINDS)[number];

/** lavfi source + filters per sound. Exported for tests. */
export const SFX_RECIPES: Record<SfxKind, { input: string; filter: string }> = {
  // Air rushing past: band-limited pink noise swelling and fading.
  whoosh: { input: 'anoisesrc=color=pink:duration=0.5:amplitude=1:sample_rate=44100', filter: 'highpass=f=300,lowpass=f=4000,afade=t=in:d=0.22,afade=t=out:st=0.22:d=0.28' },
  // Bubble pop: fast upward chirp with a sharp decay.
  pop: { input: "aevalsrc='0.7*sin(2*PI*(500+5000*t)*t)*exp(-38*t)':s=44100:d=0.14", filter: 'afade=t=out:st=0.1:d=0.04' },
  // Counter tick: tiny high click.
  tick: { input: "aevalsrc='0.5*sin(2*PI*2200*t)*exp(-140*t)':s=44100:d=0.05", filter: 'anull' },
  // Bell: two partials ringing out.
  ding: { input: "aevalsrc='0.4*(sin(2*PI*1320*t)+0.5*sin(2*PI*1980*t)+0.25*sin(2*PI*2640*t))*exp(-4.5*t)':s=44100:d=1.0", filter: 'afade=t=out:st=0.8:d=0.2' },
  // Key press: very short filtered noise burst.
  type: { input: 'anoisesrc=color=white:duration=0.03:amplitude=0.5:sample_rate=44100', filter: 'highpass=f=1800,afade=t=out:st=0.005:d=0.025' },
  // Soft low hit for titles.
  impact: { input: "aevalsrc='0.9*sin(2*PI*(90-50*t)*t)*exp(-5*t)':s=44100:d=0.7", filter: 'lowpass=f=900,afade=t=out:st=0.5:d=0.2' },
};

const cacheDir = path.join(tmpdir(), 'sis-sfx-v1');

/** Path to a generated effect, creating it on first use. */
export async function sfxFile(kind: SfxKind, opts: RunOptions = {}): Promise<string> {
  const file = path.join(cacheDir, `${kind}.wav`);
  try {
    if ((await stat(file)).size > 0) return file;
  } catch {
    /* not generated yet */
  }
  await mkdir(cacheDir, { recursive: true });
  const r = SFX_RECIPES[kind];
  const tmp = `${file}.${process.pid}.tmp.wav`;
  await runFfmpeg(['-f', 'lavfi', '-i', r.input, '-af', r.filter, '-ac', '1', '-ar', '44100', tmp], opts);
  const { rename } = await import('node:fs/promises');
  await rename(tmp, file).catch(() => undefined);
  return file;
}

export interface SfxCue {
  kind: SfxKind;
  /** Seconds on the final timeline. */
  at: number;
}

const F = 30; // composition fps — cue times mirror the animation timings in client/src/motion/scenes.tsx

/**
 * Sound cues for a video. Every scene change gets a whoosh; Motion Explainer scenes also get cues
 * matching their animations (pops as items appear, ticks while a number counts, typing in chat, a
 * bell on the call to action). Capped so effects never crowd the voice.
 */
export function sfxCues(scenes: Array<{ start: number; end: number; motion?: MotionScene | null }>, opts: { transitions: boolean }): SfxCue[] {
  const cues: SfxCue[] = [];
  const add = (kind: SfxKind, at: number, sc: { start: number; end: number }) => {
    if (at >= sc.start && at < sc.end - 0.05) cues.push({ kind, at: Math.round(at * 1000) / 1000 });
  };
  scenes.forEach((sc, i) => {
    if (i > 0 && opts.transitions) cues.push({ kind: 'whoosh', at: Math.max(0, Math.round((sc.start - 0.2) * 1000) / 1000) });
    const m = sc.motion;
    if (!m) return;
    const s = sc.start;
    switch (m.template) {
      case 'title':
        add('impact', s + 6 / F, sc);
        break;
      case 'bullets':
        m.params.items.forEach((_, k) => add('pop', s + (6 + k * 8) / F, sc));
        break;
      case 'cards':
        m.params.cards.forEach((_, k) => add('pop', s + (6 + k * 6) / F, sc));
        break;
      case 'process':
        m.params.steps.forEach((_, k) => add('pop', s + (k * 12) / F, sc));
        break;
      case 'orbit':
        m.params.icons.forEach((_, k) => add('pop', s + (8 + k * 4) / F, sc));
        break;
      case 'compare':
        add('pop', s, sc);
        add('pop', s + 10 / F, sc);
        break;
      case 'stat':
        for (let f = 2; f < 28; f += 4) add('tick', s + f / F, sc);
        add('ding', s + 28 / F, sc);
        break;
      case 'chat': {
        const dur = (sc.end - sc.start) * F;
        const typeEnd = Math.min(dur * 0.4, 6 + m.params.prompt.length * 1.2);
        for (let f = 4; f < typeEnd; f += 3) add('type', s + f / F, sc);
        add('pop', s + (typeEnd + 6) / F, sc);
        break;
      }
      case 'cta':
        add('ding', s + 10 / F, sc);
        break;
      default:
        break;
    }
  });
  return cues.sort((a, b) => a.at - b.at).slice(0, 200);
}

const VOLUME: Record<SfxKind, number> = { whoosh: 0.7, pop: 0.3, tick: 0.18, ding: 0.28, type: 0.16, impact: 0.4 };

/**
 * FFmpeg args that mix cues under the voice of `input` (video copied untouched). Each effect file is
 * read once and split to its cues. Exported for tests.
 */
export function buildSfxMixArgs(input: string, output: string, cues: SfxCue[], files: Partial<Record<SfxKind, string>>): string[] {
  const kinds = SFX_KINDS.filter((k) => cues.some((c) => c.kind === k) && files[k]);
  const args = ['-i', input];
  kinds.forEach((k) => args.push('-i', files[k]!));
  const parts: string[] = [];
  const labels: string[] = [];
  kinds.forEach((k, ki) => {
    const mine = cues.filter((c) => c.kind === k);
    const outs = mine.map((_, j) => `[${k}${j}]`);
    parts.push(`[${ki + 1}:a]volume=${VOLUME[k]},asplit=${mine.length}${outs.join('')}`);
    mine.forEach((c, j) => {
      const ms = Math.max(0, Math.round(c.at * 1000));
      parts.push(`[${k}${j}]adelay=${ms}|${ms}[${k}d${j}]`);
      labels.push(`[${k}d${j}]`);
    });
  });
  const graph = `${parts.join(';')};[0:a]${labels.join('')}amix=inputs=${labels.length + 1}:duration=first:dropout_transition=0:normalize=0[a]`;
  return [...args, '-filter_complex', graph, '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output];
}

/** Mixes generated effects into a clip's audio. No cues → returns the input path unchanged. */
export async function mixSfx(input: string, output: string, cues: SfxCue[], opts: RunOptions = {}): Promise<string> {
  if (!cues.length) return input;
  const files: Partial<Record<SfxKind, string>> = {};
  for (const k of new Set(cues.map((c) => c.kind))) files[k] = await sfxFile(k, opts);
  await runFfmpeg(buildSfxMixArgs(input, output, cues, files), opts);
  return output;
}
