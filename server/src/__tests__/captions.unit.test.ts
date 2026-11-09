import { describe, expect, it } from 'vitest';
import { assColor, assTime, buildAss, escapeAssText, fontFor, groupWords, pickKeyword } from '../services/video/captions.js';
import { fillerIntervals, mergeIntervals, remapWords } from '../services/video/transcriptMap.js';
import { isFillerToken, parseDeepgramResponse } from '../services/ai/transcription.js';
import { buildRenderArgs, filterPath, resolveFraming } from '../services/video/render.js';
import type { Word } from '../services/ai/transcription.js';

const w = (text: string, start: number, end: number, filler = false): Word => ({ text, start, end, filler });

describe('transcript remapping', () => {
  it('shifts words after a cut and drops words that were cut out', () => {
    const words = [w('hello', 0.1, 0.5), w('lost', 2.2, 2.6), w('world', 3.1, 3.5)];
    const out = remapWords(words, [
      { start: 0, end: 1 },
      { start: 3, end: 4 },
    ]);
    expect(out.map((x) => x.text)).toEqual(['hello', 'world']);
    expect(out[1]).toMatchObject({ start: 1.1, end: 1.5 }); // 3.1 - 3 + 1s of kept time before it
  });

  it('keeps a word whose ASR timing stretched over a cut pause, if enough of it remains', () => {
    // Real Deepgram case: "Every" reported as 4.32–5.76s because it absorbed "um" + a pause.
    const words = [w('talent.', 1.28, 2.08), w('Every', 4.32, 5.76), w('single', 5.76, 6.08)];
    const out = remapWords(words, [
      { start: 0, end: 2.2 },
      { start: 5.3, end: 7 },
    ]);
    expect(out.map((x) => x.text)).toEqual(['talent.', 'Every', 'single']);
    expect(out[1]).toMatchObject({ start: 2.2, end: 2.66 }); // only the kept part, clipped
  });

  it('drops filler words and turns them into cut intervals', () => {
    const words = [w('so', 0, 0.3), w('um', 0.4, 0.8, true), w('yes', 0.9, 1.2)];
    expect(fillerIntervals(words)).toEqual([{ start: 0.37, end: 0.83 }]);
    expect(remapWords(words, [{ start: 0, end: 2 }]).map((x) => x.text)).toEqual(['so', 'yes']);
  });

  it('merges overlapping cut intervals', () => {
    expect(mergeIntervals([{ start: 2, end: 3 }, { start: 0, end: 1 }, { start: 0.5, end: 1.5 }])).toEqual([
      { start: 0, end: 1.5 },
      { start: 2, end: 3 },
    ]);
  });
});

describe('caption layout', () => {
  it('groups words by count, sentence end and pauses', () => {
    const words = [w('One', 0, 0.2), w('two', 0.3, 0.5), w('three.', 0.6, 0.8), w('Four', 0.9, 1.1), w('five', 2.5, 2.7)];
    const lines = groupWords(words, { maxWords: 3, maxChars: 30 });
    expect(lines.map((l) => l.words.map((x) => x.text).join(' '))).toEqual(['One two three.', 'Four', 'five']);
  });

  it('highlights numbers first, then the longest meaningful word', () => {
    expect(pickKeyword({ words: [w('grew', 0, 1), w('300%', 1, 2), w('yearly', 2, 3)], start: 0, end: 3, keywords: [] })).toEqual([1]);
    expect(pickKeyword({ words: [w('the', 0, 1), w('consistency', 1, 2), w('wins', 2, 3)], start: 0, end: 3, keywords: [] })).toEqual([1]);
    expect(pickKeyword({ words: [w('so', 0, 1), w('it', 1, 2)], start: 0, end: 2, keywords: [] })).toEqual([]);
  });

  it('converts colours and times to ASS formats and strips override characters', () => {
    expect(assColor('#A78BFA')).toBe('&H00FA8BA7');
    expect(assTime(3725.456)).toBe('1:02:05.46');
    expect(escapeAssText('a{\\b1}b\nc')).toBe('ab1b c');
  });

  it('builds a bold-pop ASS file sized to the frame with highlighted keywords', () => {
    const { ass, lines } = buildAss({
      words: [w('Consistency', 0, 0.5), w('beats', 0.5, 0.9), w('talent.', 0.9, 1.5)],
      style: 'bold_pop',
      position: 'bottom',
      highlightColor: '#FACC15',
      width: 1080,
      height: 1920,
      language: 'en',
      platform: 'win32',
    });
    // Bold pop keeps lines short (≤18 chars): "Consistency beats" | "talent."
    expect(lines.map((l) => l.words.map((x) => x.text).join(' '))).toEqual(['Consistency beats', 'talent.']);
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('Style: Main,Segoe UI Black,92,');
    // Line 1 holds until line 2 starts (no flicker between consecutive lines).
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:00.90,Main');
    expect(ass).toContain('Dialogue: 0,0:00:00.90,0:00:01.62,Main');
    expect(ass).toContain('{\\1c&H0015CCFA}CONSISTENCY{\\1c&H00FFFFFF}');
  });

  it('builds karaoke timing and uses Indic fonts without uppercasing', () => {
    const { ass } = buildAss({
      words: [w('नमस्ते', 0, 0.6), w('दोस्तों', 0.7, 1.4)],
      style: 'karaoke',
      position: 'middle',
      highlightColor: '#A78BFA',
      width: 1080,
      height: 1920,
      language: 'hi',
      platform: 'linux',
    });
    expect(ass).toContain('Noto Sans Devanagari');
    expect(ass).toContain('{\\kf70}नमस्ते {\\kf70}दोस्तों');
    expect(fontFor('te', 'black', 'linux').family).toBe('Noto Sans Telugu');
  });
});

describe('caption size', () => {
  it('scales the font and fits fewer characters per line when larger', () => {
    const words = [w('Consistency', 0, 0.5), w('beats', 0.5, 0.9), w('talent', 0.9, 1.5)];
    const base = { words, style: 'clean_minimal' as const, position: 'bottom' as const, highlightColor: '#FFFFFF', width: 1080, height: 1920, language: 'en', platform: 'win32' as const };
    const sizeOf = (ass: string) => Number(/Style: Main,[^,]+,(\d+),/.exec(ass)![1]);
    const medium = buildAss({ ...base, size: 'medium' });
    const xl = buildAss({ ...base, size: 'xl' });
    const small = buildAss({ ...base, size: 'small' });
    expect(sizeOf(medium.ass)).toBe(Math.round(1080 * 0.052));
    expect(sizeOf(xl.ass)).toBe(Math.round(1080 * 0.052 * 1.4));
    expect(sizeOf(small.ass)).toBeLessThan(sizeOf(medium.ass));
    expect(buildAss(base).ass).toBe(medium.ass); // medium is the default
  });
});

describe('video framing', () => {
  it('auto picks a blurred background only when the shapes differ a lot', () => {
    expect(resolveFraming('auto', { width: 1920, height: 1080 }, '9:16')).toBe('blur'); // landscape → vertical
    expect(resolveFraming('auto', { width: 1080, height: 1920 }, '9:16')).toBe('crop'); // vertical → vertical
    expect(resolveFraming('auto', { width: 1080, height: 1350 }, '9:16')).toBe('crop'); // 4:5 → 9:16, small trim
    expect(resolveFraming('auto', { width: 1920, height: 1080 }, '1:1')).toBe('blur');
    expect(resolveFraming('crop', { width: 1920, height: 1080 }, '9:16')).toBe('crop'); // explicit choice wins
    expect(resolveFraming('blur', { width: 1080, height: 1920 }, '9:16')).toBe('blur');
  });

  it('builds a fit-over-blurred-copy graph, with captions on top', () => {
    const args = buildRenderArgs({
      input: 'in.mp4', output: 'out.mp4', sourceDurationSec: 5, hasAudio: false, aspect: '9:16', resolution: '1080p',
      segments: [{ start: 0, end: 5 }], framing: 'blur', captions: { assPath: 'C:/w/c.ass', fontsDir: 'C:/Fonts' },
    });
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('split=2[bgsrc][fgsrc]');
    expect(graph).toContain('boxblur');
    expect(graph).toContain('force_original_aspect_ratio=decrease');
    expect(graph).toMatch(/overlay=\(W-w\)\/2:\(H-h\)\/2,setsar=1,ass=/);
    expect(graph).not.toContain('crop=1080:1920'); // the foreground is never cropped
  });
});

describe('render integration helpers', () => {
  it('escapes Windows paths for FFmpeg filter options', () => {
    expect(filterPath('C:\\tmp\\it\'s\\captions.ass')).toBe("'C\\:/tmp/it\\'s/captions.ass'");
  });

  it('adds the ass filter after reframing only when captions are provided', () => {
    const base = { input: 'in.mp4', output: 'out.mp4', sourceDurationSec: 5, hasAudio: true, aspect: '9:16' as const, resolution: '720p' as const, segments: [{ start: 0, end: 5 }] };
    const plain = buildRenderArgs(base);
    expect(plain[plain.indexOf('-filter_complex') + 1]).not.toContain('ass=');
    const withCaps = buildRenderArgs({ ...base, captions: { assPath: 'C:/w/captions.ass', fontsDir: 'C:/Windows/Fonts' } });
    const graph = withCaps[withCaps.indexOf('-filter_complex') + 1]!;
    expect(graph.indexOf('crop=')).toBeLessThan(graph.indexOf('ass='));
  });
});

describe('Deepgram adapter parsing', () => {
  it('maps punctuated words and flags fillers', () => {
    const r = parseDeepgramResponse(
      { results: { channels: [{ alternatives: [{ words: [{ word: 'um', start: 0, end: 0.3, confidence: 0.9 }, { word: 'hello', punctuated_word: 'Hello.', start: 0.4, end: 0.8 }] }] }] } },
      'en',
    );
    expect(r.words).toEqual([
      { text: 'um', start: 0, end: 0.3, confidence: 0.9, filler: true },
      { text: 'Hello.', start: 0.4, end: 0.8, confidence: null, filler: false },
    ]);
    expect(isFillerToken('Uh,')).toBe(true);
  });

  it('rejects responses without words', () => {
    expect(() => parseDeepgramResponse({ results: {} }, 'en')).toThrow();
  });
});
