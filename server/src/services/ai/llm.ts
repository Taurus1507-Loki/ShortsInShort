import { env } from '../../config/env.js';

/** JSON-schema subset understood by Gemini's structured output (OpenAPI 3 style). */
export interface JsonSchema {
  type: 'OBJECT' | 'ARRAY' | 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  description?: string;
}

/** Provider-independent LLM interface: every call returns schema-validated JSON, never free text. */
export interface LLMProvider {
  readonly name: string;
  generateJson<T>(prompt: string, schema: JsonSchema, opts?: { signal?: AbortSignal; temperature?: number }): Promise<T>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

/** Extracts the JSON payload from a Gemini generateContent response. Exported for tests. */
export function parseGeminiResponse<T>(body: unknown): T {
  const b = body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>; promptFeedback?: { blockReason?: string } };
  if (b.promptFeedback?.blockReason) throw new LLMError(`Request blocked by the AI provider (${b.promptFeedback.blockReason}).`);
  const text = b.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new LLMError(`The AI provider returned no content (${b.candidates?.[0]?.finishReason ?? 'unknown'}).`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new LLMError('The AI provider returned malformed JSON.');
  }
}

/**
 * Google Gemini via the Generative Language API with structured JSON output.
 * REQUIRES `GEMINI_API_KEY`. Not exercised against the live API by the test suite.
 */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  /** Retries temporary failures (overloaded / rate limited) twice with a short backoff. */
  async generateJson<T>(prompt: string, schema: JsonSchema, opts: { signal?: AbortSignal; temperature?: number } = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(prompt, schema, opts);
      } catch (err) {
        const temporary = err instanceof LLMError && (err.status === 429 || err.status === 500 || err.status === 503);
        if (!temporary || attempt >= 2 || opts.signal?.aborted) throw err;
        await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
      }
    }
  }

  private async once<T>(prompt: string, schema: JsonSchema, opts: { signal?: AbortSignal; temperature?: number }): Promise<T> {
    const timeout = AbortSignal.timeout(90_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: opts.temperature ?? 0.3 },
      }),
      signal,
    });
    if (!res.ok) {
      if (res.status === 400 || res.status === 403) throw new LLMError('The AI provider rejected the request (check GEMINI_API_KEY / GEMINI_MODEL).', res.status);
      if (res.status === 429) throw new LLMError('The AI provider is rate-limiting requests; try again shortly.', 429);
      if (res.status === 503) throw new LLMError('The AI provider is overloaded right now; try again shortly.', 503);
      throw new LLMError(`The AI provider failed (HTTP ${res.status}).`, res.status);
    }
    return parseGeminiResponse<T>(await res.json());
  }
}

let retryDelayMs = 2500;
/** Test seam: backoff between retries of temporary AI failures. */
export const setLLMRetryDelay = (ms: number) => {
  retryDelayMs = ms;
};

let override: LLMProvider | null | undefined;
/** Test seam: inject a provider (null = not configured, undefined = reset to env). */
export function setLLMProvider(p: LLMProvider | null | undefined) {
  override = p;
}
export function getLLMProvider(): LLMProvider | null {
  if (override !== undefined) return override;
  return env.ai.gemini ? new GeminiProvider(env.ai.gemini.apiKey, env.ai.gemini.model) : null;
}
