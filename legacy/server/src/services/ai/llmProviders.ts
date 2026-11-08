import { LLMProvider, LLMOptions } from './providerInterfaces.js';
import { config } from '../../config/env.js';

export class GeminiLLMProvider implements LLMProvider {
  name = 'gemini-llm';
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

  isConfigured(): boolean {
    return !!config.ai.geminiApiKey;
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Gemini API key not configured');
    }

    const model = options?.model || 'gemini-1.5-flash';
    const url = `${this.baseUrl}/${model}:generateContent?key=${config.ai.geminiApiKey}`;

    const contents: any[] = [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ];

    const body: any = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 2048,
      },
    };

    if (options?.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: options.systemPrompt }],
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini LLM request failed (${res.status}): ${err}`);
    }

    const data = (await res.json()) as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return text || '';
  }

  async completeJson<T>(prompt: string, schema: any, options?: LLMOptions): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('Gemini API key not configured');
    }

    const model = options?.model || 'gemini-1.5-flash';
    const url = `${this.baseUrl}/${model}:generateContent?key=${config.ai.geminiApiKey}`;

    const jsonPrompt = `${prompt}\n\nRespond strictly with valid JSON conforming to this schema:\n${JSON.stringify(schema, null, 2)}`;

    const contents: any[] = [
      {
        role: 'user',
        parts: [{ text: jsonPrompt }],
      },
    ];

    const body: any = {
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.2,
        maxOutputTokens: options?.maxTokens ?? 2048,
        responseMimeType: 'application/json',
      },
    };

    if (options?.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: options.systemPrompt }],
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini LLM JSON request failed (${res.status}): ${err}`);
    }

    const data = (await res.json()) as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    try {
      return JSON.parse(text) as T;
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]) as T;
      throw new Error(`Failed to parse JSON from Gemini response: ${text.slice(0, 100)}...`);
    }
  }
}

export class OpenAILLMProvider implements LLMProvider {
  name = 'openai-llm';
  private baseUrl = 'https://api.openai.com/v1';

  isConfigured(): boolean {
    return !!config.ai.openaiApiKey;
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('OpenAI API key not configured');
    }

    const messages = [];
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.ai.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model || 'gpt-4o-mini',
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2000,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI LLM failed: ${res.status}`);
    }

    const data = (await res.json()) as any;
    return data.choices?.[0]?.message?.content || '';
  }

  async completeJson<T>(prompt: string, schema: any, options?: LLMOptions): Promise<T> {
    const jsonPrompt = `${prompt}\n\nRespond ONLY with valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}`;
    const response = await this.complete(jsonPrompt, { ...options, temperature: 0.3 });
    try {
      return JSON.parse(response) as T;
    } catch {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]) as T;
      throw new Error('Failed to parse JSON from LLM response');
    }
  }
}

export class MockLLMProvider implements LLMProvider {
  name = 'mock-llm';

  isConfigured(): boolean {
    return true;
  }

  async complete(prompt: string): Promise<string> {
    return `Mock LLM response for: ${prompt.slice(0, 100)}...`;
  }

  async completeJson<T>(_prompt: string, schema: any): Promise<T> {
    return this.generateMockJson(schema) as T;
  }

  private generateMockJson(schema: any): any {
    if (!schema || !schema.properties) return {};
    const result: any = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      const p = prop as any;
      if (p.type === 'string') result[key] = p.enum?.[0] || 'mock';
      else if (p.type === 'number') result[key] = p.minimum || 1;
      else if (p.type === 'boolean') result[key] = true;
      else if (p.type === 'array') result[key] = [];
      else if (p.type === 'object') result[key] = this.generateMockJson(p);
    }
    return result;
  }
}

export function getLLMProvider(preferred?: 'gemini' | 'openai' | 'mock'): LLMProvider {
  if (preferred === 'gemini' || (!preferred && config.ai.geminiApiKey)) {
    return new GeminiLLMProvider();
  }
  if (preferred === 'openai' || (!preferred && config.ai.openaiApiKey)) {
    return new OpenAILLMProvider();
  }
  return new MockLLMProvider();
}
