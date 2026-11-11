import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg } from '../services/video/ffmpeg.js';
import type { CloneOptions, SynthesisOptions, SynthesisResult, TtsProvider, VoiceInfo } from '../services/ai/tts.js';

export const SEC_PER_CHAR = 0.04;

export const VOICES: VoiceInfo[] = [
  { id: 'voiceA1', name: 'Asha', category: 'premade', gender: 'female', age: 'young', accent: 'indian', description: 'warm', useCase: 'narration', previewUrl: null, languages: ['en', 'hi'] },
  { id: 'voiceB2', name: 'Ravi', category: 'premade', gender: 'male', age: 'middle aged', accent: 'indian', description: 'calm', useCase: 'news', previewUrl: null, languages: ['en'] },
];

/** Stand-in provider: real MP3 audio (a tone) with linear per-character timings. Never calls a paid API. */
export class FakeTts implements TtsProvider {
  readonly name = 'fake-tts';
  calls: Array<{ text: string; opts: SynthesisOptions }> = [];
  clones: CloneOptions[] = [];
  deleted: string[] = [];
  failWith: Error | null = null;
  cloneFailWith: Error | null = null;
  private n = 0;
  constructor(private readonly dir: string) {}
  async listVoices() {
    return VOICES;
  }
  async synthesize(text: string, opts: SynthesisOptions): Promise<SynthesisResult> {
    this.calls.push({ text, opts });
    if (this.failWith) throw this.failWith;
    const dur = Math.max(0.5, text.length * SEC_PER_CHAR);
    const file = path.join(this.dir, `tts-${++this.n}.mp3`);
    await runFfmpeg(['-f', 'lavfi', '-i', `sine=frequency=330:duration=${dur}`, '-c:a', 'libmp3lame', '-b:a', '64k', file]);
    const characters = [...text];
    return {
      audio: await readFile(file),
      mimeType: 'audio/mpeg' as const,
      model: 'fake-model',
      alignment: {
        characters,
        starts: characters.map((_, i) => i * SEC_PER_CHAR),
        ends: characters.map((_, i) => (i + 1) * SEC_PER_CHAR),
      },
    };
  }
  async cloneVoice(opts: CloneOptions) {
    this.clones.push(opts);
    if (this.cloneFailWith) throw this.cloneFailWith;
    return `clone${this.clones.length}`;
  }
  async deleteVoice(voiceId: string) {
    this.deleted.push(voiceId);
  }
}
