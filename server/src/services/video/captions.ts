import type { Word } from '../ai/transcription.js';

export type CaptionStyle = 'bold_pop' | 'clean_minimal' | 'karaoke' | 'boxed' | 'cinematic';
export type CaptionPosition = 'top' | 'middle' | 'bottom';
export type CaptionSize = 'small' | 'medium' | 'large' | 'xl';

/** Font-size multipliers for the user's caption size choice. */
export const CAPTION_SIZE_SCALE: Record<CaptionSize, number> = { small: 0.8, medium: 1, large: 1.2, xl: 1.4 };

export interface CaptionLine {
  words: Word[];
  start: number;
  end: number;
  /** Indices into `words` to highlight. */
  keywords: number[];
}

interface StyleSpec {
  maxWords: number;
  maxChars: number;
  /** Font size as a fraction of the frame's short side. */
  size: number;
  uppercase: boolean;
  highlight: boolean;
  weight: 'black' | 'semibold';
}

export const STYLE_SPECS: Record<CaptionStyle, StyleSpec> = {
  bold_pop: { maxWords: 3, maxChars: 18, size: 0.085, uppercase: true, highlight: true, weight: 'black' },
  karaoke: { maxWords: 5, maxChars: 28, size: 0.068, uppercase: false, highlight: true, weight: 'black' },
  clean_minimal: { maxWords: 7, maxChars: 36, size: 0.052, uppercase: false, highlight: true, weight: 'semibold' },
  boxed: { maxWords: 5, maxChars: 26, size: 0.06, uppercase: false, highlight: true, weight: 'black' },
  cinematic: { maxWords: 6, maxChars: 34, size: 0.048, uppercase: true, highlight: false, weight: 'semibold' },
};

const STOPWORDS = new Set(
  'a an the and or but if then so to of in on at by for with from as is are was were be been being it its this that these those i you he she we they me my your our their his her them us do does did not no yes just very really can will would should could have has had about into over than more most also what when where which who how why'.split(
    ' ',
  ),
);

const bare = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}%₹$]/gu, '');

/** Groups words into short caption lines, breaking on word/char limits, pauses and sentence ends. */
export function groupWords(words: Word[], opts: { maxWords: number; maxChars: number; maxGapSec?: number }): CaptionLine[] {
  const maxGap = opts.maxGapSec ?? 0.6;
  const lines: CaptionLine[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({ words: cur, start: cur[0]!.start, end: cur[cur.length - 1]!.end, keywords: [] });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (cur.length && (cur.length >= opts.maxWords || chars > opts.maxChars || (prev && w.start - prev.end > maxGap))) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return lines;
}

/**
 * Rule-based keyword pick (one per line): numbers/money/percentages first, otherwise the longest
 * meaningful word. Phase 2.3 replaces this with LLM-chosen keywords when an LLM key is configured.
 */
export function pickKeyword(line: CaptionLine): number[] {
  let best = -1;
  let bestScore = 0;
  line.words.forEach((w, i) => {
    const b = bare(w.text);
    if (!b || STOPWORDS.has(b)) return;
    let score = /\d|%|₹|\$/.test(b) ? 10 : b.length >= 5 ? b.length / 2 : 0;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best >= 0 && bestScore >= 2.5 ? [best] : [];
}

/** #RRGGBB → ASS &HAABBGGRR (alpha 00 = opaque). */
export function assColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const rgb = m ? m[1]! : 'FFFFFF';
  const [r, g, b] = [rgb.slice(0, 2), rgb.slice(2, 4), rgb.slice(4, 6)];
  return `&H${alpha.toString(16).padStart(2, '0')}${b}${g}${r}`.toUpperCase();
}

export function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** Removes characters that ASS would interpret as override tags or line breaks. */
export const escapeAssText = (t: string) => t.replace(/[{}\\]/g, '').replace(/\r?\n/g, ' ');

const INDIC = new Set(['hi', 'mr', 'te', 'ta']);

/** Font family by language/weight; the OS font folder is passed to libass as `fontsdir`. */
export function fontFor(language: string, weight: 'black' | 'semibold', platform = process.platform): { family: string; bold: boolean } {
  if (platform === 'win32') {
    if (INDIC.has(language)) return { family: 'Nirmala UI', bold: true };
    return weight === 'black' ? { family: 'Segoe UI Black', bold: false } : { family: 'Segoe UI Semibold', bold: false };
  }
  const noto: Record<string, string> = { hi: 'Noto Sans Devanagari', mr: 'Noto Sans Devanagari', te: 'Noto Sans Telugu', ta: 'Noto Sans Tamil' };
  return { family: noto[language] ?? 'Noto Sans', bold: true };
}

export interface BuildAssInput {
  words: Word[];
  style: CaptionStyle;
  position: CaptionPosition;
  highlightColor: string;
  width: number;
  height: number;
  language: string;
  size?: CaptionSize;
  platform?: NodeJS.Platform;
}

/** Builds a complete ASS subtitle file for burning into the rendered video. */
export function buildAss(input: BuildAssInput): { ass: string; lines: CaptionLine[] } {
  const spec = STYLE_SPECS[input.style];
  const landscape = input.width > input.height;
  const short = Math.min(input.width, input.height);
  const scale = CAPTION_SIZE_SCALE[input.size ?? 'medium'];
  const fontSize = Math.round(short * spec.size * scale);
  const outline = input.style === 'boxed' ? Math.round(fontSize * 0.28) : Math.max(2, Math.round(fontSize * (input.style === 'clean_minimal' ? 0.05 : 0.09)));
  const font = fontFor(input.language, spec.weight, input.platform);
  const latin = !INDIC.has(input.language);

  // Bigger text fits fewer characters per line (and vice versa).
  const lines = groupWords(input.words, {
    maxWords: spec.maxWords,
    maxChars: Math.max(8, Math.round((spec.maxChars * (landscape ? 1.6 : 1)) / scale)),
  });
  if (spec.highlight) lines.forEach((l) => (l.keywords = pickKeyword(l)));

  const alignment = input.position === 'top' ? 8 : input.position === 'middle' ? 5 : 2;
  const marginV = input.position === 'middle' ? 0 : Math.round(input.height * (input.position === 'top' ? 0.12 : landscape ? 0.1 : 0.22));
  const marginLR = Math.round(input.width * 0.08);

  const white = assColor('#FFFFFF');
  const hl = assColor(input.highlightColor);
  // karaoke: words sweep from Secondary (white) to Primary (highlight) as they are spoken.
  const primary = input.style === 'karaoke' ? hl : white;
  const secondary = white;
  const outlineColour = input.style === 'boxed' ? assColor('#000000', 0x60) : assColor('#000000');
  const back = assColor('#000000', input.style === 'clean_minimal' ? 0x80 : 0xff);
  const borderStyle = input.style === 'boxed' ? 3 : 1;
  const shadow = input.style === 'clean_minimal' ? 2 : 0;
  const spacing = input.style === 'cinematic' ? Math.round(fontSize * 0.12) : 0;

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${input.width}`,
    `PlayResY: ${input.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Main,${font.family},${fontSize},${primary},${secondary},${outlineColour},${back},${font.bold ? -1 : 0},0,0,0,100,100,${spacing},0,${borderStyle},${outline},${shadow},${alignment},${marginLR},${marginLR},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = lines.map((line, i) => {
    const next = lines[i + 1];
    const hold = input.style === 'bold_pop' ? 0.12 : 0.3;
    const end = next && next.start - line.end < 0.6 ? next.start : line.end + hold;
    const text = (w: Word) => {
      const t = escapeAssText(w.text);
      return spec.uppercase && latin ? t.toUpperCase() : t;
    };

    let body: string;
    if (input.style === 'karaoke') {
      body = line.words
        .map((w, j) => {
          const until = line.words[j + 1]?.start ?? w.end;
          const cs = Math.max(1, Math.round((until - w.start) * 100));
          return `{\\kf${cs}}${text(w)}`;
        })
        .join(' ');
    } else {
      body = line.words.map((w, j) => (line.keywords.includes(j) ? `{\\1c${hl}}${text(w)}{\\1c${white}}` : text(w))).join(' ');
    }

    const intro =
      input.style === 'bold_pop'
        ? '{\\fscx72\\fscy72\\t(0,90,\\fscx108\\fscy108)\\t(90,160,\\fscx100\\fscy100)}'
        : input.style === 'cinematic'
          ? '{\\fad(180,180)}'
          : input.style === 'clean_minimal'
            ? '{\\fad(80,80)}'
            : '';
    return `Dialogue: 0,${assTime(line.start)},${assTime(end)},Main,,0,0,0,,${intro}${body}`;
  });

  return { ass: [...header, ...events, ''].join('\n'), lines };
}
