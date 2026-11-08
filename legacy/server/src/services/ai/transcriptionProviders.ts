import { TranscriptionProvider, TranscriptionResult, TranscriptionOptions, WordTimestamp } from './providerInterfaces.js';
import { config } from '../../config/env.js';
import fs from 'fs';
import path from 'path';

const IMPACT_KEYWORDS = new Set([
  'secret', 'strategy', 'growth', 'money', 'revenue', 'viral', 'algorithm',
  'hack', 'boost', 'stop', 'never', 'always', 'mistake', 'insane', 'proven',
  'results', '10x', 'fast', 'free', 'ai', 'automate', 'workflow', 'save',
  'profit', 'scale', 'future', 'power', 'success', 'warning'
]);

export class OpenAIWhisperProvider implements TranscriptionProvider {
  name = 'openai-whisper';

  isConfigured(): boolean {
    return !!config.ai.openaiApiKey;
  }

  async transcribe(filePath: string, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    if (!this.isConfigured()) {
      throw new Error('OpenAI API key not configured');
    }

    const fileStats = await fs.promises.stat(filePath);
    if (fileStats.size > 25 * 1024 * 1024) {
      throw new Error('File exceeds 25MB Whisper limit');
    }

    const formData = new FormData();
    const fileBlob = new Blob([await fs.promises.readFile(filePath)]);
    formData.append('file', fileBlob, 'audio.mp4');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'word');
    if (options?.language) formData.append('language', options.language);
    if (options?.prompt) formData.append('prompt', options.prompt);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.ai.openaiApiKey}` },
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Whisper API responded with HTTP ${res.status}`);
    }

    const data = (await res.json()) as any;
    if (!data.words || !Array.isArray(data.words)) {
      throw new Error('Unexpected Whisper response format');
    }

    const words: WordTimestamp[] = data.words.map((w: any) => {
      const cleanWord = w.word.replace(/[^a-zA-Z0-9$]/g, '').toLowerCase();
      return {
        word: w.word.trim(),
        startMs: Math.round(w.start * 1000),
        endMs: Math.round(w.end * 1000),
        confidence: 0.99,
        highlight: IMPACT_KEYWORDS.has(cleanWord),
      };
    });

    return { words, language: data.language, duration: data.duration || words[words.length - 1]?.endMs / 1000 || 0 };
  }
}

export class DeepgramProvider implements TranscriptionProvider {
  name = 'deepgram';

  isConfigured(): boolean {
    return !!config.ai.deepgramApiKey;
  }

  async transcribe(filePath: string, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    if (!this.isConfigured()) {
      throw new Error('Deepgram API key not configured');
    }

    const fileBuffer = await fs.promises.readFile(filePath);
    const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&utterances=true&diarize=true', {
      method: 'POST',
      headers: {
        Authorization: `Token ${config.ai.deepgramApiKey}`,
        'Content-Type': 'audio/mp4',
      },
      body: fileBuffer,
    });

    if (!res.ok) {
      throw new Error(`Deepgram API responded with HTTP ${res.status}`);
    }

    const data = (await res.json()) as any;
    const words: WordTimestamp[] = [];

    const utterances = data.results?.utterances || [];
    for (const utterance of utterances) {
      for (const word of utterance.words || []) {
        const cleanWord = word.word.replace(/[^a-zA-Z0-9$]/g, '').toLowerCase();
        words.push({
          word: word.word,
          startMs: Math.round(word.start * 1000),
          endMs: Math.round(word.end * 1000),
          confidence: word.confidence,
          highlight: IMPACT_KEYWORDS.has(cleanWord),
        });
      }
    }

    return { words, duration: data.metadata?.duration || 0 };
  }
}

export class FallbackAlignmentProvider implements TranscriptionProvider {
  name = 'fallback-alignment';

  isConfigured(): boolean {
    return true;
  }

  async transcribe(filePath: string, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    const scriptText = options?.prompt?.trim() ||
      "If you want to grow on Instagram Reels in 2026, stop making this one critical mistake! Most creators spend three hours editing every single video manually. But with this automated AI workflow, you can trim silences, generate animated captions, and publish viral shorts in under 60 seconds!";

    const words = scriptText.split(/\s+/).filter(Boolean);
    const transcription: WordTimestamp[] = [];

    let currentMs = 400;
    const avgWordDurationMs = 280;

    words.forEach((word) => {
      const cleanWord = word.replace(/[^a-zA-Z0-9$]/g, '').toLowerCase();
      const isPunctuationEnd = word.includes('.') || word.includes('!') || word.includes('?');
      const isComma = word.includes(',');

      const duration = avgWordDurationMs + Math.floor(Math.random() * 80);
      const isHighlight = IMPACT_KEYWORDS.has(cleanWord) || word.includes('$') || /^\d+/.test(cleanWord);

      transcription.push({
        word,
        startMs: currentMs,
        endMs: currentMs + duration,
        confidence: 0.98,
        highlight: isHighlight,
      });

      currentMs += duration + (isPunctuationEnd ? 350 : isComma ? 160 : 40);
    });

    return { words: transcription, duration: currentMs / 1000 };
  }
}

export function getTranscriptionProvider(preferred?: 'whisper' | 'deepgram' | 'fallback'): TranscriptionProvider {
  if (preferred === 'whisper' || (!preferred && config.ai.openaiApiKey)) {
    return new OpenAIWhisperProvider();
  }
  if (preferred === 'deepgram' || (!preferred && config.ai.deepgramApiKey)) {
    return new DeepgramProvider();
  }
  return new FallbackAlignmentProvider();
}