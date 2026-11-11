import { env } from '../../config/env.js';
import { SarvamProvider } from './sarvam.js';

/** A voice the user can pick. Provider-neutral. */
export interface VoiceInfo {
  id: string;
  name: string;
  /** premade = provider library voice; cloned/professional = account-owned. */
  category: string;
  gender: string | null;
  age: string | null;
  accent: string | null;
  description: string | null;
  useCase: string | null;
  /** Public sample clip hosted by the provider. */
  previewUrl: string | null;
  /** Languages the provider has verified for this voice (informational). */
  languages: string[];
}

export interface CharAlignment {
  characters: string[];
  starts: number[];
  ends: number[];
}

export interface SynthesisResult {
  audio: Buffer;
  mimeType: 'audio/mpeg';
  /** Per-character timings when the provider returns them; null otherwise. */
  alignment: CharAlignment | null;
  model: string;
}

export interface SynthesisOptions {
  voiceId: string;
  language: string;
  /** 0.7–1.2, 1 = normal. */
  speed?: number;
  /** Neighbouring text so chunked narration keeps a natural flow. */
  previousText?: string;
  nextText?: string;
  signal?: AbortSignal;
}

export interface CloneOptions {
  name: string;
  description?: string;
  language?: string;
  /** Audio files (MP3) of the person speaking. */
  files: Array<{ filename: string; data: Buffer; mimeType: string }>;
  signal?: AbortSignal;
}

/** Provider-independent text-to-speech interface. */
export interface TtsProvider {
  readonly name: string;
  /** The provider's shared library voices only — never account-owned clones. */
  listVoices(signal?: AbortSignal): Promise<VoiceInfo[]>;
  synthesize(text: string, opts: SynthesisOptions): Promise<SynthesisResult>;
  /** Creates an instant voice clone; returns the provider's voice id. */
  cloneVoice(opts: CloneOptions): Promise<string>;
  /** Deletes a cloned voice at the provider (idempotent: a missing voice is not an error). */
  deleteVoice(voiceId: string, signal?: AbortSignal): Promise<void>;
  /** Longest text per synthesis request for this voice (default 2500). */
  maxChars?(voiceId: string): number;
  /** When set, cloning uses one reference clip of at most this many seconds. */
  readonly cloneSampleSec?: number;
}

export class TtsError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** True when retrying cannot help (bad key, unknown voice, quota used up). */
    public readonly permanent = false,
  ) {
    super(message);
    this.name = 'TtsError';
  }
}

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/**
 * Groups per-character timings into words (split on whitespace), shifted by `offset` seconds.
 * Exported for tests.
 */
export function alignmentToWords(a: CharAlignment, offset = 0): TimedWord[] {
  const words: TimedWord[] = [];
  let text = '';
  let start = 0;
  let end = 0;
  const flush = () => {
    if (text.trim()) words.push({ text: text.trim(), start: round(start + offset), end: round(end + offset) });
    text = '';
  };
  const n = Math.min(a.characters.length, a.starts.length, a.ends.length);
  for (let i = 0; i < n; i++) {
    const ch = a.characters[i]!;
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    if (!text) start = a.starts[i]!;
    text += ch;
    end = Math.max(end, a.ends[i]!);
  }
  flush();
  return words;
}

const round = (s: number) => Math.round(s * 1000) / 1000;

/**
 * Splits a script into chunks of at most `max` characters at sentence boundaries (falls back to
 * word boundaries for very long sentences). Handles Latin and Devanagari full stops.
 */
export function splitScript(script: string, max = 2500): string[] {
  const text = script.replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?।\n]+(?:[.!?।]+|\n+|$)/g) ?? [text];
  const chunks: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };
  for (const raw of sentences) {
    const s = raw.replace(/\n+/g, ' ');
    if (s.length > max) {
      push();
      for (const w of s.split(/\s+/)) {
        if (cur.length + w.length + 1 > max) push();
        cur += (cur ? ' ' : '') + w;
      }
      continue;
    }
    if (cur.length + s.length > max) push();
    cur += s;
  }
  push();
  return chunks;
}

interface ElevenVoice {
  voice_id: string;
  name?: string;
  category?: string;
  description?: string | null;
  labels?: Record<string, string> | null;
  preview_url?: string | null;
  verified_languages?: Array<{ language: string }> | null;
}

/** Maps an ElevenLabs voice to the neutral shape. Exported for tests. */
export function parseElevenVoice(v: ElevenVoice): VoiceInfo {
  const l = v.labels ?? {};
  const pretty = (s: string | undefined) => (s ? s.replace(/[_-]+/g, ' ').trim() : null);
  return {
    id: v.voice_id,
    name: (v.name ?? 'Voice').slice(0, 80),
    category: v.category ?? 'premade',
    gender: pretty(l.gender),
    age: pretty(l.age),
    accent: pretty(l.accent),
    description: pretty(l.description ?? l.descriptive) ?? (v.description ? v.description.slice(0, 200) : null),
    useCase: pretty(l.use_case ?? l.use_cases),
    previewUrl: v.preview_url && /^https:\/\//.test(v.preview_url) ? v.preview_url : null,
    languages: [...new Set((v.verified_languages ?? []).map((x) => x.language).filter(Boolean))],
  };
}

/** Languages ElevenLabs multilingual v2 does not cover; these go to the Indic model (v3). */
const NEEDS_INDIC_MODEL = new Set(['te', 'mr']);

/**
 * ElevenLabs text-to-speech with character timestamps.
 * REQUIRES `ELEVENLABS_API_KEY`. Not exercised against the live API by the test suite.
 */
export class ElevenLabsProvider implements TtsProvider {
  readonly name = 'elevenlabs';
  private readonly base = 'https://api.elevenlabs.io';
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly indicModel: string,
  ) {}

  private async request(path: string, init: RequestInit & { signal?: AbortSignal }) {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { 'xi-api-key': this.apiKey, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (res.ok) return res;
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    if (res.status === 401) {
      if (/quota/i.test(detail)) throw new TtsError('Your ElevenLabs character quota is used up.', 401, true);
      throw new TtsError('The voice provider rejected the API key.', 401, true);
    }
    if (res.status === 402 || /quota_exceeded|insufficient/i.test(detail)) throw new TtsError('Your ElevenLabs character quota is used up.', res.status, true);
    if (res.status === 403) throw new TtsError('The voice provider refused this request for your account plan.', 403, true);
    if (res.status === 404) throw new TtsError('That voice no longer exists at the provider.', 404, true);
    if (res.status === 400 || res.status === 422) throw new TtsError(`The voice provider couldn't read this script (${detail.slice(0, 200)}).`, res.status, true);
    if (res.status === 429) throw new TtsError('The voice provider is busy (rate limited). Retrying shortly.', 429);
    throw new TtsError(`Voice generation failed (HTTP ${res.status}).`, res.status);
  }

  async listVoices(signal?: AbortSignal): Promise<VoiceInfo[]> {
    const out: VoiceInfo[] = [];
    let token: string | null = null;
    for (let page = 0; page < 5; page++) {
      // Premade only: clones on the platform account belong to individual workspaces and are
      // listed from our own records, never from the provider's account-wide list.
      const qs = new URLSearchParams({ page_size: '100', include_total_count: 'false', category: 'premade' });
      if (token) qs.set('next_page_token', token);
      const res = await this.request(`/v2/voices?${qs}`, { method: 'GET', signal });
      const body = (await res.json()) as { voices?: ElevenVoice[]; has_more?: boolean; next_page_token?: string | null };
      for (const v of body.voices ?? []) if (v?.voice_id && (v.category ?? 'premade') === 'premade') out.push(parseElevenVoice(v));
      if (!body.has_more || !body.next_page_token) break;
      token = body.next_page_token;
    }
    return out;
  }

  async cloneVoice(opts: CloneOptions): Promise<string> {
    const form = new FormData();
    form.append('name', opts.name.slice(0, 100));
    if (opts.description) form.append('description', opts.description.slice(0, 500));
    if (opts.language) form.append('labels', JSON.stringify({ language: opts.language }));
    form.append('remove_background_noise', 'false');
    for (const f of opts.files) form.append('files', new Blob([new Uint8Array(f.data)], { type: f.mimeType }), f.filename);
    const res = await fetch(`${this.base}/v1/voices/add`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, Accept: 'application/json' },
      body: form,
      signal: opts.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 500);
      if (res.status === 401 && !/quota/i.test(detail)) throw new TtsError('The voice provider rejected the API key.', 401, true);
      if (/can_not_use_instant_voice_cloning|subscription|upgrade|voice_limit|limit_reached|too many voices/i.test(detail) || res.status === 403) {
        throw new TtsError('The voice provider account can’t create more cloned voices (plan or voice-slot limit). The platform owner needs to upgrade the ElevenLabs plan.', res.status, true);
      }
      if (res.status === 400 || res.status === 422) throw new TtsError(`The voice provider couldn’t use these recordings (${detail.slice(0, 200)}).`, res.status, true);
      if (res.status === 429) throw new TtsError('The voice provider is busy (rate limited). Retrying shortly.', 429);
      throw new TtsError(`Voice cloning failed (HTTP ${res.status}).`, res.status);
    }
    const body = (await res.json()) as { voice_id?: string };
    if (!body.voice_id) throw new TtsError('The voice provider returned no voice id.');
    return body.voice_id;
  }

  async deleteVoice(voiceId: string, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${this.base}/v1/voices/${encodeURIComponent(voiceId)}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': this.apiKey, Accept: 'application/json' },
      signal,
    });
    if (res.ok || res.status === 404) return;
    // ElevenLabs answers 400 "voice_does_not_exist" for unknown ids.
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (/does_not_exist|not found/i.test(detail)) return;
    throw new TtsError(`Could not delete the voice at the provider (HTTP ${res.status}).`, res.status);
  }

  modelFor(language: string) {
    return NEEDS_INDIC_MODEL.has(language) ? this.indicModel : this.model;
  }

  async synthesize(text: string, opts: SynthesisOptions): Promise<SynthesisResult> {
    const model = this.modelFor(opts.language);
    const body: Record<string, unknown> = {
      text,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: opts.speed ?? 1 },
    };
    // multilingual v2 rejects language_code; other models use it to pick the language.
    if (!model.startsWith('eleven_multilingual_v2')) body.language_code = opts.language;
    if (opts.previousText) body.previous_text = opts.previousText.slice(-600);
    if (opts.nextText) body.next_text = opts.nextText.slice(0, 600);
    const res = await this.request(`/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    const json = (await res.json()) as {
      audio_base64?: string;
      alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } | null;
    };
    if (!json.audio_base64) throw new TtsError('The voice provider returned no audio.');
    const a = json.alignment;
    return {
      audio: Buffer.from(json.audio_base64, 'base64'),
      mimeType: 'audio/mpeg',
      model,
      alignment:
        a && Array.isArray(a.characters) && Array.isArray(a.character_start_times_seconds) && Array.isArray(a.character_end_times_seconds)
          ? { characters: a.characters, starts: a.character_start_times_seconds, ends: a.character_end_times_seconds }
          : null,
    };
  }
}

let override: TtsProvider | null | undefined;

/** Test seam: inject a provider (or null to force "not configured"). Pass undefined to reset. */
export function setTtsProvider(p: TtsProvider | null | undefined) {
  override = p;
  voiceCache = null;
}

/** The configured provider, or null when no credentials are set. */
/**
 * The configured voice provider: Sarvam AI by default when its key is set (Indian languages, lower
 * cost), ElevenLabs otherwise or when TTS_PROVIDER=elevenlabs. null when neither is configured.
 */
export function getTtsProvider(): TtsProvider | null {
  if (override !== undefined) return override;
  const { ttsProvider, sarvam, elevenlabs } = env.ai;
  const useSarvam = sarvam && ttsProvider !== 'elevenlabs';
  if (useSarvam) return new SarvamProvider(sarvam.apiKey, sarvam.model);
  if (elevenlabs && ttsProvider !== 'sarvam') return new ElevenLabsProvider(elevenlabs.apiKey, elevenlabs.model, elevenlabs.indicModel);
  return null;
}

let voiceCache: { at: number; voices: VoiceInfo[] } | null = null;
const VOICE_TTL_MS = 10 * 60_000;

/** Voice list, cached for 10 minutes (the library rarely changes). */
export async function listVoicesCached(): Promise<VoiceInfo[]> {
  const p = getTtsProvider();
  if (!p) return [];
  if (voiceCache && Date.now() - voiceCache.at < VOICE_TTL_MS) return voiceCache.voices;
  const voices = await p.listVoices();
  voiceCache = { at: Date.now(), voices };
  return voices;
}
