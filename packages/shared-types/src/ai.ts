/** AI gateway contracts: providers are swappable behind this interface. */

import type { AITask, AIProviderId } from './enums.js';

export interface GenerateTextInput {
  task: AITask;
  system: string;
  prompt: string;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  /** Correlation id for logs; never include personal data in it. */
  requestId?: string | undefined;
}

export interface GenerateTextResult {
  text: string;
  provider: AIProviderId;
  model: string;
  promptVersion: string;
  latencyMs: number;
  usage?: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined;
}

export interface GenerateStructuredInput<T> extends GenerateTextInput {
  /** Zod schema (or anything with parse) the model output must satisfy. */
  schema: { parse: (value: unknown) => T };
  /** Optional JSON schema hint for providers that support structured outputs. */
  schemaName?: string | undefined;
}

export interface GenerateStructuredResult<T> extends Omit<GenerateTextResult, 'text'> {
  data: T;
  raw: string;
}

export interface AIProvider {
  readonly id: AIProviderId;
  readonly supportsStructuredOutput: boolean;
  isConfigured(): boolean;
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
  generateStructured<T>(input: GenerateStructuredInput<T>): Promise<GenerateStructuredResult<T>>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly options: {
      provider: AIProviderId;
      kind:
        | 'not_configured'
        | 'timeout'
        | 'rate_limited'
        | 'invalid_output'
        | 'unavailable'
        | 'refused'
        | 'bad_request';
      retryable: boolean;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

export interface AIUsageRecord {
  requestId: string;
  task: AITask;
  provider: AIProviderId;
  model: string;
  promptVersion: string;
  latencyMs: number;
  success: boolean;
  errorKind?: AIProviderError['options']['kind'] | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
}
