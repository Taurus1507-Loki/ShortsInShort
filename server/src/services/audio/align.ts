/**
 * Word timings for a voiceover when the voice provider doesn't return any (e.g. Sarvam): the script's
 * own words get times either from a transcript of the finished audio (matched word by word) or, without
 * one, from their length. Captions always show the script's words, never transcription mistakes.
 */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

const norm = (w: string) => w.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Spreads words over [start, end] by character length (longer words take longer to say). Exported for tests. */
export function estimateWords(tokens: string[], start: number, end: number): TimedWord[] {
  if (!tokens.length) return [];
  const weights = tokens.map((t) => Math.max(1, norm(t).length) + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0, end - start);
  let t = start;
  return tokens.map((text, i) => {
    const d = (weights[i]! / total) * span;
    const w = { text, start: r3(t), end: r3(t + d * 0.92) };
    t += d;
    return w;
  });
}

const similar = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))));

/**
 * Matches script words to transcript words in order (longest common subsequence with fuzzy matching),
 * takes the transcript's times for matched words and interpolates the rest by length. Falls back to a
 * pure estimate when fewer than a quarter of the words match. Exported for tests.
 */
export function alignWords(script: string, transcript: Array<{ text: string; start: number; end: number }>, totalSec: number): { words: TimedWord[]; matched: number } {
  const tokens = script.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { words: [], matched: 0 };
  const a = tokens.map(norm);
  const b = transcript.map((w) => norm(w.text));
  const n = a.length;
  const m = b.length;
  if (!m) return { words: estimateWords(tokens, 0, totalSec), matched: 0 };

  // LCS table (bounded: scripts are ≤5,000 characters, so ≤ ~1,000 words).
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] && similar(a[i]!, b[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const match = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] && similar(a[i]!, b[j]!)) {
      match[i] = j;
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  const matched = match.filter((x) => x >= 0).length;
  if (matched < Math.max(1, n * 0.25)) return { words: estimateWords(tokens, 0, totalSec), matched };

  const out: TimedWord[] = new Array(n);
  let k = 0;
  while (k < n) {
    if (match[k]! >= 0) {
      const w = transcript[match[k]!]!;
      out[k] = { text: tokens[k]!, start: r3(w.start), end: r3(w.end) };
      k++;
      continue;
    }
    // A run of unmatched words between the previous and next matched ones.
    let e = k;
    while (e < n && match[e]! < 0) e++;
    const from = k > 0 ? out[k - 1]!.end : 0;
    const to = e < n ? transcript[match[e]!]!.start : totalSec;
    estimateWords(tokens.slice(k, e), from, Math.max(from, to)).forEach((w, x) => (out[k + x] = w));
    k = e;
  }
  return { words: out, matched };
}
