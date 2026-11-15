/**
 * AI provider adapters.
 *
 * Each adapter speaks one vendor's HTTP API but exposes the same interface. All
 * network access uses an injected `fetch` so tests run offline with fixtures.
 * Keys are read from the server environment only and never logged or returned.
 *
 * Provider order (confirmed): Groq -> Gemini -> OpenRouter -> Hugging Face.
 */

import type {
  AIProvider,
  AIProviderError as AIProviderErrorType,
  AIProviderId,
  GenerateStructuredInput,
  GenerateStructuredResult,
  GenerateTextInput,
  GenerateTextResult,
} from '@job-hunter/shared-types';
import { AIProviderError } from '@job-hunter/shared-types';

export interface ProviderConfig {
  apiKey?: string | undefined;
  model: string;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
}

export interface ProviderContext {
  fetch: typeof globalThis.fetch;
  defaultTimeoutMs: number;
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * Shared HTTP plumbing: timeout, one bounded retry on transient errors, and
 * normalisation of failures into `AIProviderError` with a retryable flag.
 */
async function postJson<T>(
  provider: AIProviderId,
  url: string,
  context: ProviderContext,
  init: { headers: Record<string, string>; body: unknown; timeoutMs: number },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), init.timeoutMs);
  try {
    const response = await context.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...init.headers },
      body: JSON.stringify(init.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const retryable = RETRYABLE_STATUS.has(response.status);
      const detail = await response.text().catch(() => '');
      const kind =
        response.status === 429
          ? 'rate_limited'
          : response.status === 408
            ? 'timeout'
            : response.status >= 500
              ? 'unavailable'
              : 'bad_request';
      throw new AIProviderError(`${provider} responded ${response.status}`, {
        provider,
        kind,
        retryable,
        cause: detail.slice(0, 300),
      });
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    const aborted =
      error instanceof Error && (error.name === 'AbortError' || error.message === 'timeout');
    throw new AIProviderError(`${provider} request failed`, {
      provider,
      kind: aborted ? 'timeout' : 'unavailable',
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Extract the first JSON object/array from a model response (tolerates fences). */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const firstBrace = candidate.indexOf('{');
  const firstBracket = candidate.indexOf('[');
  const start =
    firstBrace === -1
      ? firstBracket
      : firstBracket === -1
        ? firstBrace
        : Math.min(firstBrace, firstBracket);
  if (start === -1) throw new Error('No JSON found in model output');
  const openingChar = candidate[start];
  const closingChar = openingChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === openingChar) depth += 1;
    else if (char === closingChar) {
      depth -= 1;
      if (depth === 0) return JSON.parse(candidate.slice(start, index + 1));
    }
  }
  throw new Error('Unterminated JSON in model output');
}

export function withRetry<T>(
  operation: () => Promise<T>,
  options: { maxRetries: number; onRetry?: (attempt: number, error: unknown) => void },
): Promise<T> {
  return (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const retryable = error instanceof AIProviderError ? error.options.retryable : false;
        if (!retryable || attempt === options.maxRetries) break;
        options.onRetry?.(attempt + 1, error);
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      }
    }
    throw lastError;
  })();
}

function validateStructured<T>(input: GenerateStructuredInput<T>, raw: string): T {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (error) {
    throw new AIProviderError('Model did not return valid JSON', {
      provider: 'mock',
      kind: 'invalid_output',
      retryable: true,
      cause: error,
    });
  }
  try {
    return input.schema.parse(parsed);
  } catch (error) {
    throw new AIProviderError('Model output did not match the required schema', {
      provider: 'mock',
      kind: 'invalid_output',
      retryable: true,
      cause: error,
    });
  }
}

// ---------------------------------------------------------------- Groq
interface ChatChoice {
  message?: { content?: string | null };
  finish_reason?: string;
}
interface ChatCompletion {
  choices?: ChatChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}

export class GroqProvider implements AIProvider {
  readonly id = 'groq' as const;
  readonly supportsStructuredOutput = true;

  constructor(
    private readonly config: ProviderConfig,
    private readonly context: ProviderContext,
    private readonly promptVersion: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const started = Date.now();
    const data = await withRetry(
      () =>
        postJson<ChatCompletion>(
          this.id,
          `${this.config.baseUrl ?? 'https://api.groq.com/openai/v1'}/chat/completions`,
          this.context,
          {
            headers: {
              authorization: `Bearer ${this.config.apiKey}`,
              'user-agent': 'JobHunter/0.1',
            },
            timeoutMs: this.config.timeoutMs ?? this.context.defaultTimeoutMs,
            body: {
              model: this.config.model,
              temperature: input.temperature ?? 0.2,
              max_tokens: input.maxTokens ?? 2000,
              messages: [
                { role: 'system', content: input.system },
                { role: 'user', content: input.prompt },
              ],
            },
          },
        ),
      { maxRetries: this.config.maxRetries ?? 1 },
    );

    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) {
      throw new AIProviderError('Groq returned an empty response', {
        provider: this.id,
        kind: 'invalid_output',
        retryable: true,
      });
    }
    return {
      text,
      provider: this.id,
      model: data.model ?? this.config.model,
      promptVersion: this.promptVersion,
      latencyMs: Date.now() - started,
      ...(data.usage
        ? {
            usage: {
              inputTokens: data.usage.prompt_tokens,
              outputTokens: data.usage.completion_tokens,
            },
          }
        : {}),
    };
  }

  async generateStructured<T>(
    input: GenerateStructuredInput<T>,
  ): Promise<GenerateStructuredResult<T>> {
    // Groq supports JSON mode; we still validate with the schema.
    const result = await this.generateText({
      ...input,
      system: `${input.system}\n\nRespond with a single JSON object and no other text.`,
    });
    const data = validateStructured(input, result.text);
    return { ...result, data, raw: result.text };
  }
}

// -------------------------------------------------------------- Gemini
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const;
  readonly supportsStructuredOutput = true;

  constructor(
    private readonly config: ProviderConfig,
    private readonly context: ProviderContext,
    private readonly promptVersion: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const started = Date.now();
    const base = this.config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const data = await withRetry(
      () =>
        postJson<GeminiResponse>(
          this.id,
          `${base}/models/${encodeURIComponent(this.config.model)}:generateContent`,
          this.context,
          {
            headers: { 'x-goog-api-key': this.config.apiKey ?? '' },
            timeoutMs: this.config.timeoutMs ?? this.context.defaultTimeoutMs,
            body: {
              systemInstruction: { parts: [{ text: input.system }] },
              contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
              generationConfig: {
                temperature: input.temperature ?? 0.2,
                maxOutputTokens: input.maxTokens ?? 2000,
              },
            },
          },
        ),
      { maxRetries: this.config.maxRetries ?? 1 },
    );

    const text =
      data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    if (!text.trim()) {
      throw new AIProviderError('Gemini returned an empty response', {
        provider: this.id,
        kind: 'invalid_output',
        retryable: true,
      });
    }
    return {
      text,
      provider: this.id,
      model: this.config.model,
      promptVersion: this.promptVersion,
      latencyMs: Date.now() - started,
      ...(data.usageMetadata
        ? {
            usage: {
              inputTokens: data.usageMetadata.promptTokenCount,
              outputTokens: data.usageMetadata.candidatesTokenCount,
            },
          }
        : {}),
    };
  }

  async generateStructured<T>(
    input: GenerateStructuredInput<T>,
  ): Promise<GenerateStructuredResult<T>> {
    const result = await this.generateText({
      ...input,
      system: `${input.system}\n\nRespond with a single JSON object and no other text.`,
    });
    const data = validateStructured(input, result.text);
    return { ...result, data, raw: result.text };
  }
}

// ---------------------------------------------------------- OpenRouter
export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter' as const;
  readonly supportsStructuredOutput = true;

  constructor(
    private readonly config: ProviderConfig,
    private readonly context: ProviderContext,
    private readonly promptVersion: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const started = Date.now();
    const data = await withRetry(
      () =>
        postJson<ChatCompletion>(
          this.id,
          `${this.config.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`,
          this.context,
          {
            headers: {
              authorization: `Bearer ${this.config.apiKey}`,
              'http-referer': 'https://github.com/Randy-Dosu/job_hunter',
              'x-title': 'Job Hunter',
            },
            timeoutMs: this.config.timeoutMs ?? this.context.defaultTimeoutMs,
            body: {
              model: this.config.model,
              temperature: input.temperature ?? 0.2,
              max_tokens: input.maxTokens ?? 2000,
              messages: [
                { role: 'system', content: input.system },
                { role: 'user', content: input.prompt },
              ],
            },
          },
        ),
      { maxRetries: this.config.maxRetries ?? 1 },
    );

    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) {
      throw new AIProviderError('OpenRouter returned an empty response', {
        provider: this.id,
        kind: 'invalid_output',
        retryable: true,
      });
    }
    return {
      text,
      provider: this.id,
      model: data.model ?? this.config.model,
      promptVersion: this.promptVersion,
      latencyMs: Date.now() - started,
      ...(data.usage
        ? {
            usage: {
              inputTokens: data.usage.prompt_tokens,
              outputTokens: data.usage.completion_tokens,
            },
          }
        : {}),
    };
  }

  async generateStructured<T>(
    input: GenerateStructuredInput<T>,
  ): Promise<GenerateStructuredResult<T>> {
    const result = await this.generateText({
      ...input,
      system: `${input.system}\n\nRespond with a single JSON object and no other text.`,
    });
    const data = validateStructured(input, result.text);
    return { ...result, data, raw: result.text };
  }
}

// --------------------------------------------------------- Hugging Face
interface HfResponse {
  generated_text?: string;
  choices?: ChatChoice[];
}

export class HuggingFaceProvider implements AIProvider {
  readonly id = 'huggingface' as const;
  /** Not all hosted models honour strict JSON; we always validate ourselves. */
  readonly supportsStructuredOutput = false;

  constructor(
    private readonly config: ProviderConfig,
    private readonly context: ProviderContext,
    private readonly promptVersion: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const started = Date.now();
    const data = await withRetry(
      () =>
        postJson<HfResponse>(
          this.id,
          `${this.config.baseUrl ?? 'https://api-inference.huggingface.co/models'}/${this.config.model}`,
          this.context,
          {
            headers: { authorization: `Bearer ${this.config.apiKey}` },
            timeoutMs: this.config.timeoutMs ?? this.context.defaultTimeoutMs,
            body: {
              inputs: `${input.system}\n\n${input.prompt}`,
              parameters: {
                temperature: input.temperature ?? 0.2,
                max_new_tokens: input.maxTokens ?? 1500,
                return_full_text: false,
              },
            },
          },
        ),
      { maxRetries: this.config.maxRetries ?? 1 },
    );

    const text = Array.isArray(data)
      ? ((data[0] as { generated_text?: string } | undefined)?.generated_text ?? '')
      : (data.generated_text ?? data.choices?.[0]?.message?.content ?? '');

    if (!text.trim()) {
      throw new AIProviderError('Hugging Face returned an empty response', {
        provider: this.id,
        kind: 'invalid_output',
        retryable: true,
      });
    }
    return {
      text,
      provider: this.id,
      model: this.config.model,
      promptVersion: this.promptVersion,
      latencyMs: Date.now() - started,
    };
  }

  async generateStructured<T>(
    input: GenerateStructuredInput<T>,
  ): Promise<GenerateStructuredResult<T>> {
    const result = await this.generateText(input);
    const data = validateStructured(input, result.text);
    return { ...result, data, raw: result.text };
  }
}

export type { AIProviderErrorType };
