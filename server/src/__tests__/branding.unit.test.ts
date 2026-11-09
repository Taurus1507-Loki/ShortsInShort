import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planZooms } from '../services/video/zooms.js';
import { buildRenderArgs, zoomExpr } from '../services/video/render.js';
import { buildWatermarkAss, type CaptionLine } from '../services/video/captions.js';
import { loadLibrary, pickTrack } from '../services/ai/music.js';

const line = (start: number, end: number, keyword = false): CaptionLine => ({ words: [{ text: 'w', start, end }], start, end, keywords: keyword ? [0] : [] });

describe('zoom planning', () => {
  it('does nothing when off', () => {
    expect(planZooms({ intensity: 'off', durationSec: 30, lines: [line(0, 2)] })).toEqual([]);
  });

  it('zooms on every Nth line, preferring lines with a highlighted keyword, skipping the opener', () => {
    const lines = [line(0, 1.5), line(1.6, 3), line(3.1, 4.5, true), line(4.6, 6), line(6.1, 7.5), line(7.6, 9, true)];
    const z = planZooms({ intensity: 'subtle', durationSec: 10, lines });
    expect(z).toEqual([
      { start: 3.1, end: 4.5, scale: 1.08 }, // group 1 (opener skipped) → keyword line
      { start: 7.6, end: 9, scale: 1.08 }, // group 2 → keyword line
    ]);
  });

  it('never zooms during B-roll and caps zoom length', () => {
    const lines = [line(0, 1), line(1.2, 6), line(6.5, 7), line(7.2, 9)];
    const z = planZooms({ intensity: 'dynamic', durationSec: 10, lines, avoid: [{ start: 6.4, end: 7.5 }] });
    expect(z.every((x) => x.end - x.start <= 2.5)).toBe(true);
    expect(z.some((x) => x.start < 7.5 && x.end > 6.4)).toBe(false);
  });

  it('falls back to a steady rhythm without a transcript', () => {
    const z = planZooms({ intensity: 'dynamic', durationSec: 12 });
    expect(z.map((x) => x.start)).toEqual([2, 6, 10]);
    expect(z[0]!.scale).toBe(1.15);
  });

  it('builds an FFmpeg zoom expression', () => {
    expect(zoomExpr([])).toBe('1');
    expect(zoomExpr([{ start: 1, end: 2, scale: 1.1 }])).toBe('1+between(t,1.000,2.000)*0.100');
  });
});

describe('licensed music library', () => {
  const lib = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sis-lib-'));
    writeFileSync(path.join(dir, 'a.mp3'), 'x');
    writeFileSync(path.join(dir, 'b.mp3'), 'x');
    writeFileSync(
      path.join(dir, 'music.json'),
      JSON.stringify([
        { file: 'a.mp3', title: 'A', artist: 'X', moods: ['Upbeat'], license: 'Licence #1' },
        { file: 'b.mp3', title: 'B', artist: 'Y', moods: ['calm'], license: 'Licence #2' },
        { file: 'missing.mp3', title: 'M', moods: ['calm'], license: 'L' }, // file absent
        { file: 'b.mp3', title: 'NoLicence', moods: ['calm'], license: '' }, // no licence
        { file: '../escape.mp3', title: 'E', moods: ['calm'], license: 'L' }, // path traversal
      ]),
    );
    return dir;
  };

  it('only loads tracks that exist inside the folder and declare a licence', () => {
    const tracks = loadLibrary(lib());
    expect(tracks.map((t) => t.title)).toEqual(['A', 'B']);
    expect(tracks[0]!.moods).toEqual(['upbeat']);
  });

  it('returns nothing without a folder or manifest', () => {
    expect(loadLibrary(null)).toEqual([]);
    expect(loadLibrary(mkdtempSync(path.join(tmpdir(), 'sis-empty-')))).toEqual([]);
  });

  it('picks by mood, maps auto to the editing style, and is stable per project', () => {
    const tracks = loadLibrary(lib());
    expect(pickTrack(tracks, 'calm', 'viral', 'p1')!.title).toBe('B');
    expect(pickTrack(tracks, 'auto', 'viral', 'p1')!.title).toBe('A'); // viral → upbeat
    expect(pickTrack(tracks, 'cinematic', 'viral', 'p1')).not.toBeNull(); // no match → any licensed track
    expect(pickTrack(tracks, 'none', 'viral', 'p1')).toBeNull();
    expect(pickTrack([], 'calm', 'viral', 'p1')).toBeNull();
    expect(pickTrack(tracks, 'cinematic', 'viral', 'same')!.title).toBe(pickTrack(tracks, 'cinematic', 'viral', 'same')!.title);
  });
});

describe('watermark and branding in the render graph', () => {
  it('builds a top-right, semi-transparent watermark for the whole video', () => {
    const ass = buildWatermarkAss({ width: 1080, height: 1920, durationSec: 30, platform: 'win32' });
    expect(ass).toContain('Made with ShortsInShort');
    expect(ass).toMatch(/Style: Mark,Segoe UI Semibold,32,&H66FFFFFF/);
    expect(ass).toMatch(/,9,\d+,\d+,\d+,1/); // alignment 9 = top-right
    expect(ass).toContain('0:00:31.00');
  });

  it('orders layers: zoom → B-roll → logo → captions → watermark, and ducks looped music under speech', () => {
    const args = buildRenderArgs({
      input: 'in.mp4', output: 'out.mp4', sourceDurationSec: 10, hasAudio: true, aspect: '9:16', resolution: '720p',
      segments: [{ start: 0, end: 10 }],
      zooms: [{ start: 2, end: 3, scale: 1.1 }],
      broll: [{ path: 'b.mp4', start: 5, end: 7 }],
      logo: { path: 'logo.png', position: 'top-left', widthFrac: 0.18, opacity: 0.8 },
      captions: { assPath: 'C:/w/c.ass', fontsDir: 'C:/F' },
      watermark: { assPath: 'C:/w/wm.ass', fontsDir: 'C:/F' },
      music: { path: 'song.mp3', volume: 0.18, duck: true },
    });
    const inputs = args.filter((_, i) => args[i - 1] === '-i');
    expect(inputs).toEqual(['in.mp4', 'b.mp4', 'logo.png', 'song.mp3']);
    expect(args[args.indexOf('song.mp3') - 3]).toBe('-stream_loop');
    const g = args[args.indexOf('-filter_complex') + 1]!;
    const order = ['eval=frame', '[b0]overlay', '[logo]overlay', "ass=filename='C\\:/w/c.ass'", "ass=filename='C\\:/w/wm.ass'"].map((k) => g.indexOf(k));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]!))).toBe(true);
    expect(g).toContain('colorchannelmixer=aa=0.80');
    expect(g).toContain('x=W*0.04:y=H*0.04');
    expect(g).toContain('sidechaincompress');
    expect(g).toContain('afade=t=out:st=8.500:d=1.500');
    expect(g).toMatch(/amix=inputs=2:duration=first:normalize=0,loudnorm/);
  });

  it('plays music alone when the source has no audio', () => {
    const args = buildRenderArgs({
      input: 'in.mp4', output: 'out.mp4', sourceDurationSec: 6, hasAudio: false, aspect: '1:1', resolution: '720p',
      segments: [{ start: 0, end: 6 }], music: { path: 'song.mp3', volume: 0.5, duck: true },
    });
    expect(args).toContain('[a]');
    expect(args).not.toContain('-an');
    expect(args[args.indexOf('-filter_complex') + 1]).not.toContain('sidechaincompress');
  });
});
