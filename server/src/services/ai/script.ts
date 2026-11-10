import type { LLMProvider } from './llm.js';
import { LLMError } from './llm.js';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi (Devanagari script)',
  te: 'Telugu (Telugu script)',
  ta: 'Tamil (Tamil script)',
  mr: 'Marathi (Devanagari script)',
};

const TONES: Record<string, string> = {
  viral: 'punchy and high-energy, short sentences, a strong hook in the first line',
  podcast: 'conversational and warm, like talking to a friend',
  cinematic: 'evocative and dramatic, vivid imagery',
  educational: 'clear and structured, one idea at a time, simple words',
  business: 'confident and professional, concrete benefits',
  storytelling: 'a short story with a beginning, a turn and a payoff',
  vlog: 'casual and personal, first person',
  product_promotion: 'persuasive and benefit-led, ending with a clear call to action',
};

/** Speaking pace used to size scripts (words per second). Indic scripts run slightly slower. */
export const wordsFor = (durationSec: number, language: string) => Math.round(durationSec * (language === 'en' ? 2.5 : 2.1));

export interface ScriptRequest {
  topic: string;
  language: string;
  durationSec: number;
  style: string;
  notes?: string;
}

export interface ScriptResult {
  title: string;
  script: string;
  hook: string;
}

/**
 * Writes a voiceover script with the LLM: spoken words only (no stage directions, emojis or hashtags),
 * sized to the requested length, in the requested language. Validated before it is returned.
 */
export async function writeScript(llm: LLMProvider, req: ScriptRequest, signal?: AbortSignal): Promise<ScriptResult> {
  const words = wordsFor(req.durationSec, req.language);
  const prompt = [
    `Write a voiceover script for a short vertical video.`,
    `Topic: ${req.topic}`,
    req.notes ? `Extra notes from the creator: ${req.notes}` : '',
    `Language: ${LANGUAGE_NAMES[req.language] ?? 'English'}. Write every word in that language and script.`,
    `Tone: ${TONES[req.style] ?? TONES.viral}.`,
    `Length: about ${words} words (≈${req.durationSec} seconds when read aloud). Never more than ${Math.round(words * 1.25)} words.`,
    'Rules: only the words to be spoken — no stage directions, scene labels, brackets, emojis, hashtags or markdown.',
    'Open with a hook that makes people keep watching. Use short sentences that are easy to say aloud. Do not invent statistics or quotes; keep claims general if unsure.',
    'Return JSON: title (max 8 words), hook (the first sentence), script (the full text including the hook).',
  ]
    .filter(Boolean)
    .join('\n');
  const out = await llm.generateJson<ScriptResult>(
    prompt,
    {
      type: 'OBJECT',
      properties: { title: { type: 'STRING' }, hook: { type: 'STRING' }, script: { type: 'STRING' } },
      required: ['title', 'hook', 'script'],
    },
    { signal, temperature: 0.8 },
  );
  const script = typeof out?.script === 'string' ? cleanScript(out.script) : '';
  if (script.length < 20) throw new LLMError('The AI returned an empty script. Try again.');
  return {
    title: typeof out.title === 'string' ? out.title.trim().slice(0, 120) : '',
    hook: typeof out.hook === 'string' ? out.hook.trim().slice(0, 300) : '',
    script: script.slice(0, 5000),
  };
}

/** Removes things that shouldn't be read aloud (markdown, bracketed directions, hashtags). Exported for tests. */
export function cleanScript(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\[[^\]]{0,80}\]|\([^)]{0,40}(?:music|pause|beat|sfx|scene)[^)]{0,40}\)/gi, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`]+/g, '')
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
