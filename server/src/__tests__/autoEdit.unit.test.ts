import { describe, expect, it } from 'vitest';
import { fallbackHook, hookText, planAutoSfx, planAutoZooms, aiHookAndMood } from '../services/video/autoEdit.js';
import { fromOutputTime, sfxToOutput } from '../services/video/edl.js';
import type { LLMProvider } from '../services/ai/llm.js';

const segs = [
  { start: 0, end: 3 },
  { start: 5, end: 10 },
];

describe('auto edit rules', () => {
  it('maps edited time back to source time across cuts', () => {
    expect(fromOutputTime(segs, 1)).toBe(1);
    expect(fromOutputTime(segs, 4)).toBe(6);
    expect(fromOutputTime(segs, 99)).toBe(10);
  });

  it('hook: prefers an early question, caps at 7 words, and is not added to very short videos', () => {
    const s = (text: string, start: number) => ({ text, start, end: start + 2 });
    expect(fallbackHook([s('Hi everyone.', 0), s('Want to grow faster?', 2), s('Here is how.', 4)])).toBe('Want to grow faster?');
    expect(fallbackHook([s('This is the one thing nobody tells you about saving money every month.', 0)])).toBe('This is the one thing nobody tells…');
    expect(fallbackHook([])).toBeNull();
    const h = hookText('Stop scrolling', segs, '#7C3AED')!;
    expect(h).toMatchObject({ start: 0, end: 2.8, position: 'top', style: 'accent', size: 'l', color: '#7C3AED' });
    // The hook lasts 2.8 s of the EDITED video, even across a cut.
    expect(hookText('x y z', [{ start: 0, end: 2 }, { start: 4, end: 10 }], '#000000')!.end).toBe(4.8);
    expect(hookText('x y z', [{ start: 0, end: 3 }], '#000000')).toBeNull();
  });

  it('zooms land on highlighted words, spaced out, never on cut moments or B-roll', () => {
    const line = (t: number, keyword = 1) => ({ words: [{ text: 'a', start: t, end: t + 0.3 }, { text: 'b', start: t + 0.4, end: t + 0.7 }, { text: 'c', start: t + 0.8, end: t + 1 }, { text: 'd', start: t + 1.1, end: t + 1.3 }], keyword });
    const zooms = planAutoZooms([line(0.5), line(2), line(3.5), line(6), line(8.6)], segs, [{ start: 8, end: 10 }]);
    // 0.9 kept; 2.4 too close; 3.9 cut; 6.4 kept; 9.0 under B-roll.
    expect(zooms.map((z) => z.at)).toEqual([0.78, 6.28]);
    expect(zooms.map((z) => z.scale)).toEqual([1.12, 1.2]);
  });

  it('sound effects: impact on the hook, whooshes around B-roll, pops on zooms, never crowded or on cuts', () => {
    const sfx = planAutoSfx({
      hook: { start: 0, end: 2.8, text: 'Hook', position: 'top' },
      broll: [{ start: 6, end: 8 }],
      zooms: [{ at: 0.3, dur: 1.5, scale: 1.12 }, { at: 4, dur: 1.5, scale: 1.2 }, { at: 9, dur: 1, scale: 1.12 }],
      durationSec: 10,
      segments: segs,
    });
    expect(sfx).toEqual([
      { at: 0, kind: 'impact' }, // the pop at 0.3 s is too close
      { at: 6, kind: 'whoosh' }, // the zoom pop at 4 s is on a cut moment
      { at: 8, kind: 'whoosh', volume: 0.7 },
      { at: 9, kind: 'pop', volume: 0.8 },
    ]);
    // Whooshes start early so they peak on the cut; effects on cut moments are dropped.
    expect(sfxToOutput([{ at: 6, kind: 'whoosh' }, { at: 4, kind: 'pop' }, { at: 1, kind: 'ding', volume: 0.5 }], segs)).toEqual([
      { kind: 'whoosh', at: 3.78, volume: 1 },
      { kind: 'ding', at: 1, volume: 0.5 },
    ]);
  });

  it('cleans up the AI hook and falls back to the style mood', async () => {
    const llm = (hook: string, mood: string): LLMProvider => ({ name: 'fake', generateJson: async <T>() => ({ hook, mood }) as T });
    const s = [{ text: 'Money tips.', start: 0, end: 1 }];
    expect(await aiHookAndMood(llm('“Save ₹10,000 every month” #money', 'upbeat'), s, { language: 'en', style: 'viral' })).toEqual({ hook: 'Save ₹10,000 every month money', mood: 'upbeat' });
    expect((await aiHookAndMood(llm('Calm down', 'disco'), s, { language: 'en', style: 'business' })).mood).toBe('corporate');
    await expect(aiHookAndMood(llm('', 'calm'), s, { language: 'en', style: 'viral' })).rejects.toThrow();
  });
});

import { parseNumber, ruleMoments, scheduleGraphics } from '../services/video/graphics.js';
import { buildRenderArgs } from '../services/video/render.js';
import { graphicsToOutput } from '../services/video/edl.js';

describe('motion graphics rules', () => {
  it('reads numbers the way people say them', () => {
    expect(parseNumber('1%')).toEqual({ value: 1, suffix: '%' });
    expect(parseNumber('₹10,000.')).toEqual({ value: 10000, prefix: '₹' });
    expect(parseNumber('3x')).toEqual({ value: 3, suffix: 'x' });
    expect(parseNumber('50K')).toEqual({ value: 50, suffix: 'K' });
    expect(parseNumber('300')).toEqual({ value: 300 });
    expect(parseNumber('2024')).toBeNull(); // a year
    expect(parseNumber('5')).toBeNull(); // too small to animate alone
    expect(parseNumber('hello')).toBeNull();
  });

  it('word rules: counters for numbers, emoji for strong words, scheduled 5 s apart off the hook', () => {
    const s = (text: string, start: number) => ({ text, start, end: start + 2.5 });
    const sentences = [s('Grow your money fast.', 0), s('You get 1% better daily.', 3), s('This idea is crazy.', 6), s('In 300 days it adds up.', 11)];
    const moments = ruleMoments(sentences);
    expect(moments.map((m) => m.graphic.kind)).toEqual(['counter', 'emoji', 'counter']);
    expect(moments[0]!.graphic).toMatchObject({ value: 1, suffix: '%' });
    expect(moments[2]!.graphic).toMatchObject({ value: 300, label: 'days it' });
    const timed = scheduleGraphics(moments, sentences, { segments: [{ start: 0, end: 20 }], avoid: [{ start: 0, end: 2.8 }], max: 5, color: '#FF0000' });
    // 3.1 kept; 6.1 too close; 11.1 kept.
    expect(timed.map((g) => g.start)).toEqual([3.1, 11.1]);
    expect(timed[0]).toMatchObject({ end: 5.7, color: '#FF0000' });
  });

  it('places graphics on the edited timeline and layers them over the video', () => {
    const out = graphicsToOutput([{ start: 4, end: 6.5, kind: 'counter', value: 3, position: 'middle' }, { start: 3.2, end: 4.1, kind: 'emoji', emoji: 'fire', position: 'top' }], [{ start: 0, end: 3 }, { start: 5, end: 10 }], 8);
    expect(out).toEqual([{ start: 3, end: 5.5, kind: 'counter', value: 3, position: 'middle' }]);
    const args = buildRenderArgs({ input: 'in.mp4', output: 'out.mp4', segments: [{ start: 0, end: 8 }], sourceDurationSec: 8, hasAudio: true, aspect: '9:16', resolution: '720p', graphics: [{ path: 'g0.mov', start: 3, end: 5.5 }] }).join(' ');
    expect(args).toContain('-i g0.mov');
    expect(args).toContain('setpts=PTS-STARTPTS+3.000/TB');
    expect(args).toContain("overlay=enable='between(t,3.000,5.500)':eof_action=pass:format=auto");
  });
});
