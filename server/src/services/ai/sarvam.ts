import { TtsError, type CloneOptions, type SynthesisOptions, type SynthesisResult, type TtsProvider, type VoiceInfo } from './tts.js';

/** Our language codes → Sarvam BCP-47 codes. */
export const SARVAM_LANGUAGES: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN', mr: 'mr-IN', bn: 'bn-IN', gu: 'gu-IN', kn: 'kn-IN', ml: 'ml-IN', pa: 'pa-IN', od: 'od-IN' };

/**
 * Bulbul v3 speakers (docs, 2026-11). Sarvam has no voice-list endpoint for stock speakers, so the list
 * lives here. Gender is filled only where the name makes it unambiguous; the rest stay unlabelled.
 */
const V3_SPEAKERS: Array<[id: string, gender: 'female' | 'male' | null]> = [
  ['shubh', 'male'], ['aditya', 'male'], ['ritu', 'female'], ['priya', 'female'], ['neha', 'female'], ['rahul', 'male'],
  ['pooja', 'female'], ['rohan', 'male'], ['simran', 'female'], ['kavya', 'female'], ['amit', 'male'], ['dev', 'male'],
  ['ishita', 'female'], ['shreya', 'female'], ['ratan', 'male'], ['varun', 'male'], ['manan', 'male'], ['sumit', 'male'],
  ['roopa', 'female'], ['kabir', 'male'], ['aayan', 'male'], ['ashutosh', 'male'], ['advait', 'male'], ['anand', 'male'],
  ['tanya', 'female'], ['tarun', 'male'], ['sunny', null], ['mani', null], ['gokul', 'male'], ['vijay', 'male'],
  ['shruti', 'female'], ['suhani', 'female'], ['mohit', 'male'], ['kavitha', 'female'], ['rehan', 'male'], ['soham', 'male'], ['rupali', 'female'],
];
const STOCK_IDS = new Set(V3_SPEAKERS.map(([id]) => id));

/** Turns a Sarvam error response into a TtsError (permanent when retrying can't help). Exported for tests. */
export function sarvamError(status: number, body: string): TtsError {
  let code = '';
  let message = '';
  try {
    const j = JSON.parse(body) as { error?: { code?: string; message?: string }; detail?: string | Array<{ msg?: string }> };
    code = j.error?.code ?? '';
    message = j.error?.message ?? (typeof j.detail === 'string' ? j.detail : Array.isArray(j.detail) ? (j.detail[0]?.msg ?? '') : '');
  } catch {
    /* not JSON */
  }
  if (status === 401 || status === 403) return new TtsError('Sarvam rejected the API key.', status, true);
  if (status === 402 || /insufficient_quota/i.test(code + body)) return new TtsError('Your Sarvam credits are used up.', status, true);
  if (status === 429) return new TtsError('Sarvam is busy (rate limited). Retrying shortly.', 429);
  if (status === 400 || status === 422) return new TtsError(`Sarvam couldn’t use this request (${(message || body).slice(0, 200)}).`, status, true);
  if (status === 404) return new TtsError('That voice no longer exists at Sarvam.', 404, true);
  return new TtsError(`Sarvam failed (HTTP ${status}).`, status);
}

/**
 * Sarvam AI (Bulbul) text-to-speech — built for Indian languages. No word timestamps (the voiceover
 * job times words from the finished audio instead). Cloned voices go through /voices/clone.
 * REQUIRES `SARVAM_API_KEY`. Not exercised against the live API by the test suite.
 */
export class SarvamProvider implements TtsProvider {
  readonly name = 'sarvam';
  /** Cloning works best from one 10–15 s reference recording. */
  readonly cloneSampleSec = 15;
  private readonly base = 'https://api.sarvam.ai';
  constructor(
    private readonly apiKey: string,
    private readonly model = 'bulbul:v3',
  ) {}

  /** Characters per request: 2500 for stock speakers (bulbul v3), 1000 for cloned voices. */
  maxChars(voiceId: string) {
    return STOCK_IDS.has(voiceId) ? 2000 : 900;
  }

  private async call(pathname: string, init: RequestInit): Promise<Response> {
    const res = await fetch(`${this.base}${pathname}`, { ...init, headers: { 'api-subscription-key': this.apiKey, ...(init.headers as Record<string, string>) } });
    if (!res.ok) throw sarvamError(res.status, await res.text().catch(() => ''));
    return res;
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return V3_SPEAKERS.map(([id, gender]) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      category: 'premade',
      gender,
      age: null,
      accent: 'indian',
      description: null,
      useCase: null,
      // Sarvam hosts no sample clips; the app generates (and caches) a short sample on request.
      previewUrl: null,
      languages: Object.keys(SARVAM_LANGUAGES).filter((l) => ['en', 'hi', 'te', 'ta', 'mr'].includes(l)),
    }));
  }

  async synthesize(text: string, opts: SynthesisOptions): Promise<SynthesisResult> {
    const language = SARVAM_LANGUAGES[opts.language] ?? 'en-IN';
    const cloned = !STOCK_IDS.has(opts.voiceId);
    const res = cloned
      ? await this.call('/voices/clone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice_id: opts.voiceId, text, language_code: language }),
          signal: opts.signal,
        })
      : await this.call('/text-to-speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            language_code: language,
            speaker: opts.voiceId,
            model: this.model,
            pace: Math.min(2, Math.max(0.5, opts.speed ?? 1)),
            speech_sample_rate: 44100,
            output_audio_codec: 'mp3',
          }),
          signal: opts.signal,
        });
    const body = (await res.json()) as { audios?: string[]; audio?: string; audio_b64?: string };
    const list = body.audios?.length ? body.audios : [body.audio ?? body.audio_b64 ?? ''];
    const parts = list.filter(Boolean).map((s) => Buffer.from(s, 'base64'));
    if (!parts.length) throw new TtsError('Sarvam returned no audio.');
    // One audio per request in practice; several would be separate files, so keep the first.
    return { audio: parts[0]!, mimeType: 'audio/mpeg', alignment: null, model: cloned ? 'sarvam-clone' : this.model };
  }

  async cloneVoice(opts: CloneOptions): Promise<string> {
    const f = opts.files[0];
    if (!f) throw new TtsError('No voice sample to clone.', 400, true);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(f.data)], { type: f.mimeType }), f.filename);
    form.append('name', opts.name.slice(0, 100));
    if (opts.language) form.append('language', SARVAM_LANGUAGES[opts.language] ?? 'en-IN');
    const res = await this.call('/voices/create', { method: 'POST', body: form, signal: opts.signal });
    const body = (await res.json()) as { voice_id?: string; id?: string };
    const id = body.voice_id ?? body.id;
    if (!id) throw new TtsError('Sarvam returned no voice id.');
    return id;
  }

  async deleteVoice(voiceId: string, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${this.base}/voices/delete/${encodeURIComponent(voiceId)}`, { method: 'DELETE', headers: { 'api-subscription-key': this.apiKey }, signal });
    if (res.ok || res.status === 404) return;
    throw sarvamError(res.status, await res.text().catch(() => ''));
  }
}
