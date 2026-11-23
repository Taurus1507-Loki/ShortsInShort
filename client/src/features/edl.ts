/**
 * AI Video Editor timeline, browser side. Mirrors server/src/services/video/edl.ts (keep the two in
 * step): all times are seconds on the SOURCE footage. The editor computes `segments` with
 * `keepSegments` and saves them; the export renders exactly those.
 */
export interface Range {
  start: number;
  end: number;
}
export interface EditZoom {
  at: number;
  dur: number;
  scale: number;
}
export type TextStyle = 'outline' | 'box' | 'accent';
export interface EditText {
  start: number;
  end: number;
  text: string;
  position: 'top' | 'middle' | 'bottom';
  style?: TextStyle;
  size?: 's' | 'm' | 'l';
  color?: string;
}
/** One caption line, word-timed on the source footage; keyword = highlighted word index (-1 none). */
export interface EditCaption {
  words: Array<{ text: string; start: number; end: number }>;
  keyword: number;
}
/** A stock clip found for this project (the download link stays on the server). */
export interface PoolClip {
  id: string;
  provider: string;
  pageUrl: string;
  author: string;
  thumbnailUrl: string | null;
  durationSec: number;
  width: number;
  height: number;
}
export interface EditBroll {
  start: number;
  end: number;
  query: string;
  clipId: string;
  candidateIds: string[];
}
export interface EditMusic {
  mode: 'auto' | 'none' | 'track';
  file?: string;
  volume: number;
  duck: boolean;
}
/** Sound effects the server synthesises (same list as server/src/services/audio/sfx.ts). */
export const SFX_KINDS = ['whoosh', 'pop', 'impact', 'ding', 'tick', 'type'] as const;
export type SfxKind = (typeof SFX_KINDS)[number];
/** A sound effect at a SOURCE moment. */
export interface EditSfx {
  at: number;
  kind: SfxKind;
  volume?: number;
}
export interface AutoSummary {
  at: string;
  hook: string | null;
  hookBy: 'ai' | 'rules' | null;
  mood: string | null;
  brollBy: 'ai' | 'keywords' | null;
  counts: { broll: number; zooms: number; sfx: number };
  music: string | null;
  notes: string[];
}
export interface EditDoc {
  sourceAssetId: string;
  analyzedAt: string;
  durationSec: number;
  silences: Range[];
  fillers: Range[];
  pauseSec: 0 | 0.3 | 0.6 | 1;
  removeFillers: boolean;
  cuts: Range[];
  restores: Range[];
  zooms: EditZoom[];
  texts: EditText[];
  captions?: EditCaption[] | null;
  broll?: EditBroll[];
  brollPool?: Record<string, PoolClip>;
  music?: EditMusic | null;
  sfx?: EditSfx[];
  auto?: AutoSummary | null;
  segments: Range[];
}
export interface Word {
  text: string;
  start: number;
  end: number;
  filler?: boolean;
}

export const PAD_SEC = 0.12;
const MIN_KEEP = 0.2;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function mergeRanges(list: Range[]): Range[] {
  const sorted = list.filter((i) => i.end > i.start).map((i) => ({ ...i })).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end + 0.001) last.end = Math.max(last.end, i.end);
    else out.push(i);
  }
  return out;
}

export function subtractRanges(a: Range[], b: Range[]): Range[] {
  const out: Range[] = [];
  for (const x of a) {
    let pieces = [{ ...x }];
    for (const y of b) {
      pieces = pieces.flatMap((p) => {
        if (y.end <= p.start || y.start >= p.end) return [p];
        const rest: Range[] = [];
        if (y.start > p.start) rest.push({ start: p.start, end: y.start });
        if (y.end < p.end) rest.push({ start: y.end, end: p.end });
        return rest;
      });
    }
    out.push(...pieces);
  }
  return out;
}

type CutInputs = Pick<EditDoc, 'durationSec' | 'silences' | 'fillers' | 'pauseSec' | 'removeFillers' | 'cuts' | 'restores'>;

/** What the edit removes, tagged by why (for colouring the timeline). */
export function removedRanges(e: CutInputs): Range[] {
  const auto: Range[] = [];
  if (e.pauseSec > 0) {
    for (const s of e.silences) {
      if (s.end - s.start < e.pauseSec) continue;
      const start = s.start <= 0.01 ? 0 : s.start + PAD_SEC;
      const end = s.end >= e.durationSec - 0.01 ? e.durationSec : s.end - PAD_SEC;
      if (end - start > 0.05) auto.push({ start, end });
    }
  }
  if (e.removeFillers) auto.push(...e.fillers);
  return subtractRanges(mergeRanges([...auto, ...e.cuts]), mergeRanges(e.restores));
}

export function keepSegments(e: CutInputs): Range[] {
  const keep = subtractRanges([{ start: 0, end: e.durationSec }], mergeRanges(removedRanges(e)));
  return keep.filter((k) => k.end - k.start >= MIN_KEEP).map((k) => ({ start: r3(k.start), end: r3(k.end) }));
}

export const totalLength = (segs: Range[]) => segs.reduce((t, s) => t + (s.end - s.start), 0);

/** Source time → edited-video time (null if cut). */
export function toOutput(segments: Range[], t: number): number | null {
  let offset = 0;
  for (const s of segments) {
    if (t >= s.start && t <= s.end) return offset + (t - s.start);
    offset += s.end - s.start;
  }
  return null;
}

/** Edited-video time → source time. */
export function toSource(segments: Range[], t: number): number {
  let offset = 0;
  for (const s of segments) {
    const len = s.end - s.start;
    if (t <= offset + len) return s.start + Math.max(0, t - offset);
    offset += len;
  }
  return segments.length ? segments[segments.length - 1]!.end : 0;
}

/** A source range on the edited timeline (kept part only), or null when entirely cut. */
export function rangeToOutput(segments: Range[], start: number, end: number): Range | null {
  let offset = 0;
  let a: number | null = null;
  let b: number | null = null;
  for (const s of segments) {
    const x = Math.max(start, s.start);
    const y = Math.min(end, s.end);
    if (y > x) {
      if (a === null) a = offset + (x - s.start);
      b = offset + (y - s.start);
    }
    offset += s.end - s.start;
  }
  return a !== null && b !== null && b > a ? { start: a, end: b } : null;
}

/** Words moved onto the edited timeline (words mostly cut are dropped, like the export does). */
export function remapWords(words: Word[], segments: Range[]): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    if (w.filler) continue;
    const r = rangeToOutput(segments, w.start, w.end);
    if (r && r.end - r.start >= (w.end - w.start) * 0.5) out.push({ text: w.text, start: r.start, end: r.end });
  }
  return out;
}

const STYLE_WORDS: Record<string, number> = { bold_pop: 3, karaoke: 5, clean_minimal: 7, boxed: 5, cinematic: 6 };

/** Caption lines for the preview: short lines broken at pauses and punctuation, longest word highlighted. */
export function previewLines(words: Word[], style: string) {
  const max = STYLE_WORDS[style] ?? 4;
  const lines: Array<{ start: number; end: number; words: Word[]; keywords: number[] }> = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    let best = 0;
    cur.forEach((w, i) => {
      if (w.text.replace(/\W/g, '').length > cur[best]!.text.replace(/\W/g, '').length) best = i;
    });
    lines.push({ start: cur[0]!.start, end: cur[cur.length - 1]!.end, words: cur, keywords: style === 'cinematic' ? [] : [best] });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (cur.length >= max || (prev && w.start - prev.end > 0.6)) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.text)) flush();
  }
  flush();
  return lines;
}

/** Timeline captions on the edited video (cut words dropped) — the same rule as the export. */
export function captionsToOutput(captions: EditCaption[], segments: Range[]) {
  const out: Array<{ start: number; end: number; words: Word[]; keywords: number[] }> = [];
  for (const c of captions) {
    const words: Word[] = [];
    let keyword = -1;
    c.words.forEach((w, i) => {
      const r = rangeToOutput(segments, w.start, w.end);
      if (!r || r.end - r.start < (w.end - w.start) * 0.5) return;
      if (i === c.keyword) keyword = words.length;
      words.push({ text: w.text, start: r.start, end: r.end });
    });
    if (words.length) out.push({ words, start: words[0]!.start, end: words[words.length - 1]!.end, keywords: keyword >= 0 ? [keyword] : [] });
  }
  return out;
}

/** New wording for a caption line: words spread over the line's time by length (like the export's timeTokens). */
export function retimeCaption(c: EditCaption, text: string): EditCaption {
  const tokens = text.trim().split(/\s+/).filter(Boolean).slice(0, 20);
  if (!tokens.length) return c;
  const start = c.words[0]!.start;
  const end = c.words[c.words.length - 1]!.end;
  const weights = tokens.map((t) => Math.max(1, t.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = start;
  const words = tokens.map((text, i) => {
    const d = ((end - start) * weights[i]!) / total;
    const w = { text, start: Math.round(t * 1000) / 1000, end: Math.round((t + d) * 1000) / 1000 };
    t += d;
    return w;
  });
  return { words, keyword: Math.min(c.keyword, words.length - 1) };
}

/** Seconds a sound starts before its moment so it peaks on the cut (same as the export). */
export const SFX_LEAD: Partial<Record<SfxKind, number>> = { whoosh: 0.22 };

/** Sound effects on the edited timeline (effects on cut moments are dropped) — same rule as the export. */
export function sfxToOutput(sfx: EditSfx[], segments: Range[]) {
  return sfx.flatMap((x) => {
    const t = toOutput(segments, x.at);
    return t === null ? [] : [{ kind: x.kind, at: Math.max(0, t - (SFX_LEAD[x.kind] ?? 0)), volume: x.volume ?? 1 }];
  });
}
