import { describe, expect, it } from 'vitest';
import { computeKeepSegments, parseSilences, totalDuration } from '../services/video/silence.js';
import { buildRenderArgs, outputSize } from '../services/video/render.js';
import { editorCreditCost, resolutionAllowed } from '../config/credits.js';

describe('silence parsing', () => {
  it('parses silencedetect output, including a trailing open silence', () => {
    const stderr = [
      '[silencedetect @ 0x1] silence_start: 1.5',
      '[silencedetect @ 0x1] silence_end: 3.25 | silence_duration: 1.75',
      '[silencedetect @ 0x1] silence_start: 8.9',
    ].join('\n');
    expect(parseSilences(stderr, 10)).toEqual([
      { start: 1.5, end: 3.25 },
      { start: 8.9, end: 10 },
    ]);
  });
});

describe('keep segments', () => {
  it('inverts silences and pads the kept speech', () => {
    const keep = computeKeepSegments(10, [{ start: 2, end: 5 }], { padSec: 0.2 });
    expect(keep).toEqual([
      { start: 0, end: 2.2 },
      { start: 4.8, end: 10 },
    ]);
  });

  it('merges segments whose padding overlaps', () => {
    const keep = computeKeepSegments(10, [{ start: 2, end: 2.3 }], { padSec: 0.2 });
    expect(keep).toEqual([{ start: 0, end: 10 }]);
  });

  it('keeps the whole clip when everything is silent', () => {
    expect(computeKeepSegments(5, [{ start: 0, end: 5 }], { padSec: 0.1 })).toEqual([{ start: 0, end: 5 }]);
  });

  it('caps the number of segments', () => {
    const silences = Array.from({ length: 400 }, (_, i) => ({ start: i * 1 + 0.5, end: i * 1 + 0.9 }));
    const keep = computeKeepSegments(400, silences, { padSec: 0.01, maxSegments: 50 });
    expect(keep.length).toBe(50);
    expect(totalDuration(keep)).toBeLessThanOrEqual(400);
  });
});

describe('render settings', () => {
  it('computes platform frame sizes', () => {
    expect(outputSize('9:16', '1080p')).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('16:9', '720p')).toEqual({ width: 1280, height: 720 });
    expect(outputSize('1:1', '1080p')).toEqual({ width: 1080, height: 1080 });
    expect(outputSize('4:5', '1080p')).toEqual({ width: 1080, height: 1350 });
  });

  it('only adds select filters when cutting, and never uses a shell', () => {
    const base = { input: 'in.mp4', output: 'out.mp4', sourceDurationSec: 10, hasAudio: true, aspect: '9:16' as const, resolution: '720p' as const };
    const full = buildRenderArgs({ ...base, segments: [{ start: 0, end: 10 }] }).join(' ');
    expect(full).not.toContain('select=');
    const cut = buildRenderArgs({ ...base, segments: [{ start: 0, end: 2 }, { start: 4, end: 10 }] });
    const graph = cut[cut.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain("select='between(t,0,2)+between(t,4,10)'");
    expect(graph).toContain('loudnorm');
    expect(graph).toContain('crop=720:1280');
  });
});

describe('credit pricing', () => {
  it('charges per started source minute with a 4K multiplier', () => {
    expect(editorCreditCost(30, '1080p')).toBe(1);
    expect(editorCreditCost(61, '1080p')).toBe(2);
    expect(editorCreditCost(30, '4k')).toBe(2);
  });
  it('enforces plan resolution caps', () => {
    expect(resolutionAllowed('720p', '720p')).toBe(true);
    expect(resolutionAllowed('1080p', '720p')).toBe(false);
    expect(resolutionAllowed('4k', '4k')).toBe(true);
  });
});
