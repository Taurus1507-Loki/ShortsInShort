import { describe, expect, it } from 'vitest';
import { parseGeminiResponse, type LLMProvider } from '../services/ai/llm.js';
import { parsePixabayVideos, rankClips, type StockClip } from '../services/ai/stock.js';
import { aiKeywords, matchKeyword, planBroll, scheduleBroll, timeTokens, toSentences, translateLines } from '../services/ai/creative.js';
import { buildRenderArgs } from '../services/video/render.js';
import type { CaptionLine } from '../services/video/captions.js';

const line = (text: string, start: number, end: number): CaptionLine => ({
  words: text.split(' ').map((t, i, a) => ({ text: t, start: start + ((end - start) * i) / a.length, end: start + ((end - start) * (i + 1)) / a.length })),
  start,
  end,
  keywords: [],
});

/** Fake LLM answering by which property the schema asks for. */
const fakeLLM = (answers: Record<string, unknown>): LLMProvider => ({
  name: 'fake',
  async generateJson<T>(_p: string, schema: { properties?: Record<string, unknown> }) {
    const key = Object.keys(schema.properties ?? {})[0]!;
    return { [key]: answers[key] } as T;
  },
});

describe('provider response parsing', () => {
  it('reads Gemini structured JSON', () => {
    expect(parseGeminiResponse<{ a: number }>({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] })).toEqual({ a: 1 });
    expect(() => parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] })).toThrow(/malformed/);
    expect(() => parseGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(/blocked/);
  });

  it('maps Pixabay hits to clips, preferring the 720p rendition', () => {
    const clips = parsePixabayVideos({
      hits: [{ id: 7, pageURL: 'https://pixabay.com/videos/x-7/', duration: 12, user: 'ann', videos: { large: { url: 'L', width: 1920, height: 1080, size: 9 }, medium: { url: 'M', width: 1280, height: 720, size: 5 } } }],
    });
    expect(clips).toEqual([{ id: '7', provider: 'pixabay', downloadUrl: 'M', pageUrl: 'https://pixabay.com/videos/x-7/', author: 'ann', width: 1280, height: 720, durationSec: 12, tags: [] }]);
  });
});

describe('stock clip relevance', () => {
  it('ranks by tag match, weighting the subject (last word) — real Pixabay results for "stacking gold coins"', () => {
    const c = (id: string, tags: string[]): StockClip => ({ id, provider: 'pixabay', downloadUrl: '', pageUrl: '', author: '', width: 1280, height: 720, durationSec: 20, tags });
    const ranked = rankClips(
      [
        c('3735', ['elevator', 'shopping center', 'gold', 'yellow', 'light']),
        c('233867', ['ocean', 'sea', 'gold', 'shiny']),
        c('12564', ['coin', 'back', 'money', 'slowly']),
        c('35565', ['gold wash', 'pan', 'gold']),
      ],
      'stacking gold coins',
    );
    expect(ranked[0]!.id).toBe('12564'); // coins → coin, the subject, beats "gold"
    expect(ranked.map((x) => x.id).slice(1)).toEqual(['3735', '233867', '35565']); // ties keep provider order
  });
});

describe('AI keywords and translation', () => {
  it('matches keywords to words regardless of punctuation and case', () => {
    expect(matchKeyword(['You', 'get', '1%', 'better.'], 'Better')).toBe(3);
    expect(matchKeyword(['నిలకడ', 'ప్రతిభను', 'జయిస్తుంది.'], 'నిలకడ')).toBe(0);
    expect(matchKeyword(['a', 'b'], '')).toBe(-1);
  });

  it('applies AI-picked keywords and keeps rule-based ones on misses', async () => {
    const lines = [line('consistency beats talent', 0, 1), line('every single day', 1, 2)];
    lines[1]!.keywords = [1];
    const out = await aiKeywords(fakeLLM({ keywords: ['beats', 'nonexistent'] }), lines, 'en');
    expect(out[0]!.keywords).toEqual([1]);
    expect(out[1]!.keywords).toEqual([1]);
  });

  it('translates line by line, keeping each line’s timing', async () => {
    const lines = [line('Consistency beats talent.', 0, 2), line('Every single day.', 2.5, 4)];
    const out = await translateLines(fakeLLM({ lines: [{ text: 'నిలకడ ప్రతిభను జయిస్తుంది.', keyword: 'నిలకడ' }, { text: 'ప్రతి రోజు.', keyword: 'రోజు.' }] }), lines, 'en', 'te');
    expect(out.map((l) => l.words.map((w) => w.text).join(' '))).toEqual(['నిలకడ ప్రతిభను జయిస్తుంది.', 'ప్రతి రోజు.']);
    expect(out[0]).toMatchObject({ start: 0, end: 2, keywords: [0] });
    expect(out[1]!.words[0]!.start).toBe(2.5);
    expect(out[1]!.words.at(-1)!.end).toBe(4);
  });

  it('rejects a translation that changes the number of lines', async () => {
    await expect(translateLines(fakeLLM({ lines: [{ text: 'x', keyword: 'x' }] }), [line('a', 0, 1), line('b', 1, 2)], 'en', 'hi')).rejects.toThrow(/count/);
  });

  it('times translated tokens proportionally to their length', () => {
    const t = timeTokens('ab abcd', 0, 3);
    expect(t).toEqual([
      { text: 'ab', start: 0, end: 1 },
      { text: 'abcd', start: 1, end: 3 },
    ]);
  });
});

describe('B-roll planning', () => {
  it('splits words into sentences on punctuation and pauses', () => {
    const s = toSentences([
      { text: 'Hello', start: 0, end: 0.3 },
      { text: 'there.', start: 0.3, end: 0.6 },
      { text: 'New', start: 0.7, end: 0.9 },
      { text: 'idea', start: 2, end: 2.4 },
    ]);
    expect(s.map((x) => x.text)).toEqual(['Hello there.', 'New', 'idea']);
  });

  it('enforces hook protection, length limits, spacing and a cap', () => {
    const out = scheduleBroll(
      [
        { start: 0.5, end: 4, query: 'hook' }, // trimmed to start at 2s
        { start: 3, end: 5, query: 'too close' },
        { start: 9, end: 20, query: 'long' }, // capped at 3.5s
        { start: 14, end: 15, query: 'too short' },
        { start: 25, end: 29.5, query: 'near end' }, // cut at duration - 1
      ],
      { durationSec: 29, maxCount: 3 },
    );
    expect(out).toEqual([
      { start: 2, end: 4, query: 'hook' },
      { start: 9, end: 12.5, query: 'long' },
      { start: 25, end: 28, query: 'near end' },
    ]);
  });

  it('never uses the hook sentence and drops invalid indices from the AI', async () => {
    const sentences = [
      { start: 0, end: 3, text: 'Hook line.' },
      { start: 3.5, end: 8, text: 'Coffee every morning.' },
      { start: 9, end: 12, text: 'Then go running.' },
    ];
    const out = await planBroll(fakeLLM({ moments: [{ sentence: 0, queries: ['hook'] }, { sentence: 1, queries: ['coffee cup', 'morning coffee'] }, { sentence: 9, queries: ['bad'] }] }), sentences, { intensity: 'high', durationSec: 14, language: 'en' });
    expect(out).toEqual([{ start: 3.65, end: 7.15, query: 'coffee cup', alternatives: ['morning coffee'] }]);
  });
});

describe('B-roll in the render graph', () => {
  it('adds each clip as an input, overlays it only during its slot, and keeps captions on top', () => {
    const args = buildRenderArgs({
      input: 'in.mp4', output: 'out.mp4', sourceDurationSec: 10, hasAudio: true, aspect: '9:16', resolution: '720p',
      segments: [{ start: 0, end: 10 }], captions: { assPath: 'C:/w/c.ass', fontsDir: 'C:/F' },
      broll: [{ path: 'b0.mp4', start: 3, end: 5.5 }, { path: 'b1.mp4', start: 7, end: 9 }],
    });
    expect(args.filter((a, i) => args[i - 1] === '-i')).toEqual(['in.mp4', 'b0.mp4', 'b1.mp4']);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain("[base0][b0]overlay=enable='between(t,3.000,5.500)'");
    expect(graph).toContain("[base1][b1]overlay=enable='between(t,7.000,9.000)'");
    expect(graph).toContain('setpts=PTS-STARTPTS+3.000/TB');
    expect(graph).toContain('[base2]setsar=1,ass=');
  });
});
