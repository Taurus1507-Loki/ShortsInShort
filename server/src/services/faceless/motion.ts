import { z } from 'zod';
import type { LLMProvider } from '../ai/llm.js';

/**
 * Motion Explainer scene contract (mirrors client/src/motion/types.ts, which renders it).
 * Everything the LLM returns is validated here before it is stored or rendered — no free-form code.
 */
export const MOTION_ICONS = [
  'sparkles', 'brain', 'cpu', 'bot', 'message', 'image', 'video', 'music', 'file', 'lightbulb',
  'rocket', 'trending', 'chart', 'pie', 'money', 'coins', 'wallet', 'cart', 'users', 'user',
  'heart', 'star', 'clock', 'calendar', 'globe', 'pin', 'home', 'building', 'briefcase', 'school',
  'book', 'code', 'phone', 'laptop', 'camera', 'zap', 'shield', 'lock', 'check', 'target',
  'leaf', 'sun', 'coffee', 'fitness', 'food', 'plane', 'car', 'gift',
] as const;

const txt = (max: number) => z.string().trim().min(1).max(max);
const icon = z.enum(MOTION_ICONS);
const iconItem = z.object({ icon, label: txt(24) }).strict();

export const motionSceneSchema = z.discriminatedUnion('template', [
  z.object({ template: z.literal('title'), params: z.object({ eyebrow: txt(30).optional(), headline: txt(60) }).strict() }).strict(),
  z.object({ template: z.literal('statement'), params: z.object({ text: txt(120), highlight: txt(30).optional() }).strict() }).strict(),
  z.object({ template: z.literal('stat'), params: z.object({ value: txt(12), label: txt(60) }).strict() }).strict(),
  z.object({ template: z.literal('bullets'), params: z.object({ title: txt(40).optional(), items: z.array(txt(40)).min(2).max(4) }).strict() }).strict(),
  z.object({ template: z.literal('cards'), params: z.object({ title: txt(40).optional(), cards: z.array(iconItem).min(2).max(4) }).strict() }).strict(),
  z.object({ template: z.literal('process'), params: z.object({ steps: z.array(iconItem).min(2).max(4) }).strict() }).strict(),
  z
    .object({
      template: z.literal('compare'),
      params: z.object({ leftTitle: txt(24), leftPoints: z.array(txt(36)).min(1).max(3), rightTitle: txt(24), rightPoints: z.array(txt(36)).min(1).max(3) }).strict(),
    })
    .strict(),
  z.object({ template: z.literal('chat'), params: z.object({ prompt: txt(80), reply: txt(140) }).strict() }).strict(),
  z.object({ template: z.literal('orbit'), params: z.object({ centerIcon: icon, label: txt(40), icons: z.array(icon).min(3).max(6) }).strict() }).strict(),
  z.object({ template: z.literal('cta'), params: z.object({ headline: txt(50), action: txt(30) }).strict() }).strict(),
]);
export type MotionScene = z.infer<typeof motionSceneSchema>;
export const MOTION_TEMPLATES = ['title', 'statement', 'stat', 'bullets', 'cards', 'process', 'compare', 'chat', 'orbit', 'cta'] as const;

/** Validates a scene; returns null when it doesn't fit its template. */
export function parseMotionScene(v: unknown): MotionScene | null {
  const r = motionSceneSchema.safeParse(v);
  return r.success ? r.data : null;
}

const cut = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1);
  return `${head.slice(0, Math.max(head.lastIndexOf(' '), Math.floor(max * 0.6)))}…`;
};

/**
 * A safe scene when the AI is unavailable or its answer doesn't validate: the opening becomes a title,
 * everything else a statement of (the start of) its own narration.
 */
export function fallbackMotionScene(text: string, index: number): MotionScene {
  const first = (text.match(/^[^.!?।]+[.!?।]?/)?.[0] ?? text).trim();
  if (index === 0) return { template: 'title', params: { headline: cut(first, 60) } };
  return { template: 'statement', params: { text: cut(first, 120) } };
}

/** Keeps only the fields a template uses (the LLM answers with one superset shape). */
function pick(template: string, p: Record<string, unknown>): unknown {
  const keys: Record<string, string[]> = {
    title: ['eyebrow', 'headline'],
    statement: ['text', 'highlight'],
    stat: ['value', 'label'],
    bullets: ['title', 'items'],
    cards: ['title', 'cards'],
    process: ['steps'],
    compare: ['leftTitle', 'leftPoints', 'rightTitle', 'rightPoints'],
    chat: ['prompt', 'reply'],
    orbit: ['centerIcon', 'label', 'icons'],
    cta: ['headline', 'action'],
  };
  const out: Record<string, unknown> = {};
  for (const k of keys[template] ?? []) {
    const v = p[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return { template, params: out };
}


/**
 * Asks the LLM to choose a template and fill its fields for each (fixed) scene. Answers are
 * validated per template; anything invalid becomes a safe fallback scene, never a broken render.
 */
export async function planMotionScenes(
  llm: LLMProvider,
  scenes: Array<{ text: string }>,
  opts: { language: string; topic?: string },
  signal?: AbortSignal,
): Promise<{ scenes: MotionScene[]; fallbacks: number }> {
  const lang = opts.language === 'en' ? 'English' : `the language with code "${opts.language}" (use its native script)`;
  const prompt = [
    'You design animated explainer videos. For each narrated scene below, choose ONE template and fill its fields with SHORT on-screen text that supports (not repeats word for word) the narration.',
    opts.topic ? `Topic: ${opts.topic}` : '',
    `On-screen text language: ${lang}.`,
    'Templates and fields (respect the limits; never invent statistics — use "stat" only when the narration states a number):',
    '- title: eyebrow (≤30, optional), headline (≤60) — openings and section headings',
    '- statement: text (≤120), highlight (one word from text, optional) — one strong idea',
    '- stat: value (≤12, e.g. "73%", "10x"), label (≤60) — a number from the narration',
    '- bullets: title (≤40, optional), items (2–4, each ≤40) — short points',
    '- cards: title (optional), cards (2–4 of {icon, label ≤24}) — several things',
    '- process: steps (2–4 of {icon, label ≤24}) — a sequence or how something works',
    '- compare: leftTitle, leftPoints (1–3, ≤36), rightTitle, rightPoints (1–3) — before/after, this vs that',
    '- chat: prompt (≤80), reply (≤140) — asking a question and getting an answer',
    '- orbit: centerIcon, label (≤40), icons (3–6) — one idea with related things around it',
    '- cta: headline (≤50), action (≤30) — closing call to action (only for the final scene, if it asks viewers to act)',
    `Icons (use exactly these names): ${MOTION_ICONS.join(', ')}.`,
    'Vary templates between neighbouring scenes. Product names may appear only if the narration says them.',
    "Answer per scene: index, template, and params = a JSON object string with ONLY that template's fields (lists as JSON arrays, icon items as {\"icon\",\"label\"}).",
    'Scenes (index: narration):',
    ...scenes.map((s, i) => `${i}: ${s.text}`),
  ]
    .filter(Boolean)
    .join('\n');

  // A tiny schema (template + its fields as a JSON string): a flat schema with every template's
  // fields made the model fill unrelated fields with junk instead of the chosen template's.
  const out = await llm.generateJson<{ scenes: Array<{ index: number; template: string; params: string }> }>(
    prompt,
    {
      type: 'OBJECT',
      properties: {
        scenes: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              index: { type: 'INTEGER' },
              template: { type: 'STRING', enum: [...MOTION_TEMPLATES] },
              params: { type: 'STRING', description: 'JSON object with ONLY the chosen template fields, e.g. {"headline":"…"}' },
            },
            required: ['index', 'template', 'params'],
          },
        },
      },
      required: ['scenes'],
    },
    { signal, temperature: 0.6, maxOutputTokens: 4096 },
  );

  const byIndex = new Map<number, MotionScene>();
  for (const s of out?.scenes ?? []) {
    if (!Number.isInteger(s?.index) || s.index < 0 || s.index >= scenes.length || byIndex.has(s.index)) continue;
    let fields: unknown;
    try {
      fields = typeof s.params === 'string' ? JSON.parse(s.params) : s.params;
    } catch {
      continue;
    }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    const parsed = parseMotionScene(pick(String(s.template), fields as Record<string, unknown>));
    if (parsed) byIndex.set(s.index, parsed);
  }
  let fallbacks = 0;
  const result = scenes.map((sc, i) => {
    const got = byIndex.get(i);
    if (got) return got;
    fallbacks++;
    return fallbackMotionScene(sc.text, i);
  });
  return { scenes: result, fallbacks };
}
