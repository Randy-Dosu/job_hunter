/**
 * Build the gateway from environment variables.
 *
 * Free-tier defaults per the plan. If no keys are configured, a clearly-labelled
 * deterministic mock provider is used so local development works offline.
 */

import type { AITask, AIProvider } from '@job-hunter/shared-types';
import { AIGateway } from './gateway.js';
import {
  GeminiProvider,
  GroqProvider,
  HuggingFaceProvider,
  OpenRouterProvider,
} from './provider.js';
import { MockProvider, defaultMockResponder } from './mock-provider.js';
import { PROMPT_VERSIONS } from './prompts.js';

export interface AIEnv {
  GROQ_API_KEY?: string | undefined;
  GROQ_MODEL?: string | undefined;
  GEMINI_API_KEY?: string | undefined;
  GEMINI_MODEL?: string | undefined;
  OPENROUTER_API_KEY?: string | undefined;
  OPENROUTER_MODEL?: string | undefined;
  HUGGINGFACE_API_KEY?: string | undefined;
  HUGGINGFACE_MODEL?: string | undefined;
  AI_TIMEOUT_MS?: string | undefined;
  AI_MOCK?: string | undefined;
}

export function buildProviders(
  env: AIEnv,
  context: { fetch: typeof globalThis.fetch; defaultTimeoutMs: number },
): AIProvider[] {
  const providers: AIProvider[] = [
    new GroqProvider(
      {
        ...(env.GROQ_API_KEY ? { apiKey: env.GROQ_API_KEY } : {}),
        model: env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
        timeoutMs: context.defaultTimeoutMs,
      },
      context,
      PROMPT_VERSIONS.semanticMatch,
    ),
    new GeminiProvider(
      {
        ...(env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY } : {}),
        model: env.GEMINI_MODEL ?? 'gemini-2.0-flash',
        timeoutMs: context.defaultTimeoutMs,
      },
      context,
      PROMPT_VERSIONS.semanticMatch,
    ),
    new OpenRouterProvider(
      {
        ...(env.OPENROUTER_API_KEY ? { apiKey: env.OPENROUTER_API_KEY } : {}),
        model: env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free',
        timeoutMs: context.defaultTimeoutMs,
      },
      context,
      PROMPT_VERSIONS.semanticMatch,
    ),
    new HuggingFaceProvider(
      {
        ...(env.HUGGINGFACE_API_KEY ? { apiKey: env.HUGGINGFACE_API_KEY } : {}),
        model: env.HUGGINGFACE_MODEL ?? 'mistralai/Mistral-7B-Instruct-v0.3',
        timeoutMs: context.defaultTimeoutMs,
      },
      context,
      PROMPT_VERSIONS.semanticMatch,
    ),
  ];

  if (env.AI_MOCK === 'true') {
    providers.unshift(new MockProvider(defaultMockResponder));
  }
  return providers;
}

/** Per-task provider preference. Document generation needs structured output. */
export const TASK_ORDER: Partial<Record<AITask, string[]>> = {
  job_semantic_match: ['groq', 'gemini', 'openrouter', 'huggingface', 'mock'],
  resume_tailor: ['groq', 'gemini', 'openrouter', 'mock'],
  cover_letter: ['groq', 'gemini', 'openrouter', 'mock'],
  resume_parse_extract: ['groq', 'gemini', 'openrouter', 'mock'],
};

export function createGateway(
  env: AIEnv,
  options: {
    fetch?: typeof globalThis.fetch | undefined;
    logger?: AIGatewayOptions['logger'];
    onUsage?: AIGatewayOptions['onUsage'];
  } = {},
): AIGateway {
  const timeoutMs = Number.parseInt(env.AI_TIMEOUT_MS ?? '20000', 10) || 20_000;
  const context = { fetch: options.fetch ?? globalThis.fetch, defaultTimeoutMs: timeoutMs };
  const providers = buildProviders(env, context);

  // When no real provider is configured, make the mock explicit rather than
  // silently pretending the feature works with a real model.
  const anyConfigured = providers.some(
    (provider) => provider.id !== 'mock' && provider.isConfigured(),
  );
  if (!anyConfigured && !providers.some((provider) => provider.id === 'mock')) {
    providers.push(new MockProvider(defaultMockResponder));
  }

  return new AIGateway({
    providers,
    taskOrder: TASK_ORDER,
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.onUsage ? { onUsage: options.onUsage } : {}),
  });
}

type AIGatewayOptions = ConstructorParameters<typeof AIGateway>[0];
