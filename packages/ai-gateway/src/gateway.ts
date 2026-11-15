/**
 * AI gateway: provider ordering, health, fallback and usage accounting.
 *
 * Behaviour required by the plan:
 *  - Groq primary; Gemini, OpenRouter then Hugging Face as fallbacks.
 *  - Bounded retries; never retry indefinitely.
 *  - Never silently switch to a provider/model that cannot satisfy the task's
 *    structured-output requirement.
 *  - Record provider/model/prompt version and latency for every call.
 */

import type {
  AIProvider,
  AITask,
  AIUsageRecord,
  GenerateStructuredInput,
  GenerateStructuredResult,
  GenerateTextInput,
  GenerateTextResult,
} from '@job-hunter/shared-types';
import { AIProviderError } from '@job-hunter/shared-types';

export interface GatewayOptions {
  providers: AIProvider[];
  /** Per-task preference order (provider ids). Falls back to registration order. */
  taskOrder?: Partial<Record<AITask, string[]>> | undefined;
  logger?:
    | { info: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void }
    | undefined;
  onUsage?: ((record: AIUsageRecord) => void) | undefined;
  /** Total wall-clock budget per requested operation across providers. */
  deadlineMs?: number | undefined;
}

export class NoProviderAvailableError extends Error {
  constructor(task: AITask, details: string) {
    super(`No AI provider could complete task "${task}": ${details}`);
    this.name = 'NoProviderAvailableError';
  }
}

export class AIGateway {
  private readonly providers: AIProvider[];

  constructor(private readonly options: GatewayOptions) {
    this.providers = options.providers;
  }

  /** Providers that are configured, in the order we will try them for a task. */
  orderedProviders(task: AITask, requireStructured = false): AIProvider[] {
    const preferred = this.options.taskOrder?.[task];
    const configured = this.providers.filter((provider) => provider.isConfigured());
    const ordered = preferred
      ? [...configured].sort((a, b) => {
          const indexA = preferred.indexOf(a.id);
          const indexB = preferred.indexOf(b.id);
          return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
        })
      : configured;
    return requireStructured
      ? ordered.filter((provider) => provider.supportsStructuredOutput)
      : ordered;
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const candidates = this.orderedProviders(input.task);
    return this.runWithFallback(input.task, candidates, (provider) => provider.generateText(input));
  }

  async generateStructured<T>(
    input: GenerateStructuredInput<T>,
  ): Promise<GenerateStructuredResult<T>> {
    const candidates = this.orderedProviders(input.task, true);
    return this.runWithFallback(input.task, candidates, (provider) =>
      provider.generateStructured(input),
    );
  }

  /** Cheap availability probe used by the settings screen. */
  health(): Array<{ id: string; configured: boolean; supportsStructuredOutput: boolean }> {
    return this.providers.map((provider) => ({
      id: provider.id,
      configured: provider.isConfigured(),
      supportsStructuredOutput: provider.supportsStructuredOutput,
    }));
  }

  private async runWithFallback<
    TResult extends {
      provider: string;
      model: string;
      promptVersion: string;
      latencyMs: number;
      usage?: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined;
    },
  >(
    task: AITask,
    candidates: AIProvider[],
    call: (provider: AIProvider) => Promise<TResult>,
  ): Promise<TResult> {
    if (candidates.length === 0) {
      throw new NoProviderAvailableError(task, 'no configured provider supports this task');
    }

    const failures: string[] = [];
    const deadline = this.options.deadlineMs ?? 60_000;
    const startedAt = Date.now();

    for (const provider of candidates) {
      if (Date.now() - startedAt > deadline) {
        failures.push('deadline exceeded before trying remaining providers');
        break;
      }
      try {
        const result = await call(provider);
        this.record({
          requestId: `${task}-${Date.now()}`,
          task,
          provider: provider.id,
          model: result.model,
          promptVersion: result.promptVersion,
          latencyMs: result.latencyMs,
          success: true,
          ...(result.usage?.inputTokens !== undefined
            ? { inputTokens: result.usage.inputTokens }
            : {}),
          ...(result.usage?.outputTokens !== undefined
            ? { outputTokens: result.usage.outputTokens }
            : {}),
        });
        return result;
      } catch (error) {
        const kind = error instanceof AIProviderError ? error.options.kind : 'unavailable';
        const retryable = error instanceof AIProviderError ? error.options.retryable : false;
        failures.push(`${provider.id}:${kind}`);
        this.options.logger?.warn('ai provider failed', { provider: provider.id, task, kind });
        this.record({
          requestId: `${task}-${Date.now()}`,
          task,
          provider: provider.id,
          model: 'unknown',
          promptVersion: 'unknown',
          latencyMs: 0,
          success: false,
          errorKind: kind as AIProviderError['options']['kind'],
        });
        // Invalid output is worth trying elsewhere (a different model may comply);
        // a bad request (e.g. our prompt is malformed) will fail everywhere, but we
        // still let the next provider try once rather than failing the user.
        if (!retryable && kind === 'not_configured') continue;
      }
    }

    throw new NoProviderAvailableError(task, failures.join(', '));
  }

  private record(record: AIUsageRecord): void {
    this.options.onUsage?.(record);
    this.options.logger?.info('ai usage', {
      task: record.task,
      provider: record.provider,
      success: record.success,
      latencyMs: record.latencyMs,
      errorKind: record.errorKind,
    });
  }
}
