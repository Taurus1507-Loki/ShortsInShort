import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSfxMixArgs, mixSfx, SFX_KINDS, sfxCues, sfxFile } from '../services/audio/sfx.js';
import { buildScenesArgs } from '../services/video/background.js';
import { FFMPEG, probe, runFfmpeg } from '../services/video/ffmpeg.js';

/** Mean loudness (dB) of a time window of a file's audio. */
function meanDb(file: string, from: number, to: number): number {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-ss', String(from), '-t', String(to - from), '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/mean_volume: (-?[\d.]+|-inf) dB/);
  return !m || m[1] === '-inf' ? -200 : Number(m[1]);
}

describe('sound effect cues', () => {
  const scenes = [
    { start: 0, end: 2, motion: { template: 'title' as const, params: { headline: 'Hi' } } },
    { start: 2, end: 4, motion: { template: 'stat' as const, params: { value: '73%', label: 'x' } } },
    { start: 4, end: 7, motion: { template: 'bullets' as const, params: { items: ['a', 'b', 'c'] } } },
    { start: 7, end: 9, motion: { template: 'chat' as const, params: { prompt: 'Write a short', reply: 'Sure' } } },
    { start: 9, end: 11, motion: { template: 'cta' as const, params: { headline: 'More?', action: 'Follow' } } },
  ];

  it('whooshes between scenes and follows each animation', () => {
    const cues = sfxCues(scenes, { transitions: true });
    expect(cues.filter((c) => c.kind === 'whoosh').map((c) => c.at)).toEqual([1.8, 3.8, 6.8, 8.8]);
    expect(cues.find((c) => c.kind === 'impact')!.at).toBeCloseTo(0.2, 2);
    const stat = cues.filter((c) => c.at >= 2 && c.at < 4 && c.kind !== 'whoosh');
    expect(stat.filter((c) => c.kind === 'tick').length).toBe(7);
    expect(stat.find((c) => c.kind === 'ding')!.at).toBeCloseTo(2 + 28 / 30, 2);
    expect(cues.filter((c) => c.kind === 'pop' && c.at >= 4 && c.at < 7)).toHaveLength(3);
    expect(cues.filter((c) => c.kind === 'type').length).toBeGreaterThan(3);
    expect(cues.filter((c) => c.at >= 9 && c.kind === 'ding')).toHaveLength(1);
    // Sorted and never outside the video.
    expect(cues.map((c) => c.at)).toEqual([...cues.map((c) => c.at)].sort((a, b) => a - b));
  });

  it('stock scenes only get whooshes, and none with hard cuts', () => {
    const plain = scenes.map(({ start, end }) => ({ start, end }));
    expect(sfxCues(plain, { transitions: true }).every((c) => c.kind === 'whoosh')).toBe(true);
    expect(sfxCues(plain, { transitions: false })).toEqual([]);
    // Cues that would land after a too-short scene ends are dropped.
    expect(sfxCues([{ start: 0, end: 0.3, motion: { template: 'stat', params: { value: '9', label: 'x' } } }], { transitions: true }).filter((c) => c.kind === 'ding')).toEqual([]);
  });

  it('mixes each effect file once, split to its cues', () => {
    const args = buildSfxMixArgs('in.mp4', 'out.mp4', [{ kind: 'pop', at: 1 }, { kind: 'pop', at: 2.5 }, { kind: 'ding', at: 3 }], { pop: 'pop.wav', ding: 'ding.wav' }).join(' ');
    expect(args).toContain('-i pop.wav -i ding.wav');
    expect(args).toContain('asplit=2[pop0][pop1]');
    expect(args).toContain('[pop1]adelay=2500|2500');
    expect(args).toContain('amix=inputs=4:duration=first');
    expect(args).toContain('-c:v copy');
  });
});

describe('generated sounds and mixing (real FFmpeg)', () => {
  it('generates every effect and places it exactly at its cue', async () => {
    for (const k of SFX_KINDS) {
      const info = await probe(await sfxFile(k));
      expect(info.audio).toBeTruthy();
      expect(info.durationSec).toBeGreaterThan(0.02);
    }
    const dir = await mkdtemp(path.join(tmpdir(), 'sis-sfx-'));
    const base = path.join(dir, 'base.mp4');
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=160x284:r=30:d=4', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', base]);
    const out = await mixSfx(base, path.join(dir, 'out.mp4'), [{ kind: 'ding', at: 1 }], {});
    const info = await probe(out);
    expect(Math.abs(info.durationSec - 4)).toBeLessThan(0.1);
    expect(meanDb(out, 1.0, 1.5)).toBeGreaterThan(-45); // bell audible right after its cue
    expect(meanDb(out, 0, 0.9)).toBeLessThan(-80); // silence before it
    expect(await mixSfx(base, path.join(dir, 'none.mp4'), [], {})).toBe(base); // no cues → untouched
  }, 60_000);
});

describe('scene transitions', () => {
  it('cross-fades scenes without changing the total length', async () => {
    const args = buildScenesArgs({ width: 360, height: 640, scenes: [{ path: 'a.mp4', durationSec: 2 }, { path: 'b.mp4', durationSec: 3 }], audioPath: 'v.mp3', output: 'o.mp4', transition: 'slide' }).join(' ');
    expect(args).toContain('xfade=transition=slideleft:duration=0.350:offset=1.825');
    expect(args).toContain('-t 5.000');
    expect(buildScenesArgs({ width: 360, height: 640, scenes: [{ path: 'a.mp4', durationSec: 2 }, { path: 'b.mp4', durationSec: 3 }], audioPath: 'v.mp3', output: 'o.mp4', transition: 'cut' }).join(' ')).toContain('concat=n=2');

    const dir = await mkdtemp(path.join(tmpdir(), 'sis-xf-'));
    const clip = path.join(dir, 'c.mp4');
    await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clip]);
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=d=4.5', '-c:a', 'libmp3lame', path.join(dir, 'a.mp3')]);
    for (const transition of ['fade', 'wipe'] as const) {
      const out = path.join(dir, `${transition}.mp4`);
      await runFfmpeg(buildScenesArgs({ width: 180, height: 320, scenes: [{ path: clip, durationSec: 1.5 }, { path: clip, durationSec: 1 }, { path: clip, durationSec: 2 }], audioPath: path.join(dir, 'a.mp3'), output: out, transition }));
      expect(Math.abs((await probe(out)).durationSec - 4.5)).toBeLessThan(0.05);
    }
  }, 60_000);
});
