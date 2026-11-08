import { readFile } from 'node:fs/promises';
import { env } from '../../config/env.js';

export interface Word {
  text: string;
  start: number;
  end: number;
  confidence?: number | null;
  /** Hesitation sounds ("um", "uh") the provider reported. */
  filler?: boolean;
}

export interface TranscriptResult {
  provider: string;
  language: string;
  words: Word[];
}

/** Provider-independent speech-to-text interface; add Whisper/AssemblyAI adapters alongside. */
export interface TranscriptionProvider {
  readonly name: string;
  transcribe(audioPath: string, opts: { language: string; signal?: AbortSignal }): Promise<TranscriptResult>;
}

export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

const FILLERS = new Set(['um', 'uh', 'erm', 'er', 'hmm', 'mm', 'uhm', 'umm', 'ah']);
export const isFillerToken = (w: string) => FILLERS.has(w.toLowerCase().replace(/[^a-z]/g, ''));

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence?: number;
}

/** Parses Deepgram's pre-recorded response into provider-neutral words. Exported for tests. */
export function parseDeepgramResponse(body: unknown, language: string): TranscriptResult {
  const words = (body as { results?: { channels?: Array<{ alternatives?: Array<{ words?: DeepgramWord[] }> }> } })?.results
    ?.channels?.[0]?.alternatives?.[0]?.words;
  if (!Array.isArray(words)) throw new TranscriptionError('Transcription returned no words.');
  return {
    provider: 'deepgram',
    language,
    words: words
      .filter((w) => typeof w.start === 'number' && typeof w.end === 'number' && w.end >= w.start)
      .map((w) => ({
        text: (w.punctuated_word ?? w.word).trim(),
        start: w.start,
        end: w.end,
        confidence: w.confidence ?? null,
        filler: isFillerToken(w.word),
      }))
      .filter((w) => w.text.length > 0),
  };
}

/**
 * Deepgram pre-recorded transcription with word timestamps.
 * REQUIRES `DEEPGRAM_API_KEY`. Not exercised against the live API by the test suite.
 */
export class DeepgramProvider implements TranscriptionProvider {
  readonly name = 'deepgram';
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async transcribe(audioPath: string, opts: { language: string; signal?: AbortSignal }): Promise<TranscriptResult> {
    const qs = new URLSearchParams({
      model: this.model,
      language: opts.language,
      smart_format: 'true',
      punctuate: 'true',
      filler_words: 'true',
    });
    const res = await fetch(`https://api.deepgram.com/v1/listen?${qs}`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': 'audio/mpeg' },
      body: await readFile(audioPath),
      signal: opts.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      if (res.status === 401 || res.status === 403) throw new TranscriptionError('Transcription provider rejected the API key.', res.status);
      if (res.status === 400) throw new TranscriptionError(`Transcription isn't available for this language or audio (${detail}).`, 400);
      throw new TranscriptionError(`Transcription failed (HTTP ${res.status}).`, res.status);
    }
    return parseDeepgramResponse(await res.json(), opts.language);
  }
}

let override: TranscriptionProvider | null | undefined;

/** Test seam: inject a provider (or null to force "not configured"). Pass undefined to reset. */
export function setTranscriptionProvider(p: TranscriptionProvider | null | undefined) {
  override = p;
}

/** The configured provider, or null when no credentials are set (feature reports "not enabled"). */
export function getTranscriptionProvider(): TranscriptionProvider | null {
  if (override !== undefined) return override;
  return env.ai.deepgram ? new DeepgramProvider(env.ai.deepgram.apiKey, env.ai.deepgram.model) : null;
}
