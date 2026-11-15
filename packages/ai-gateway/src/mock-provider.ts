/**
 * Deterministic mock provider.
 *
 * Used by tests and by local development when no API keys are configured, so the
 * whole product works offline without pretending to be a real model. It is
 * clearly labelled (`provider: 'mock'`) everywhere it appears in UI data.
 */

import type {
  AIProvider,
  GenerateStructuredInput,
  GenerateStructuredResult,
  GenerateTextInput,
  GenerateTextResult,
} from '@job-hunter/shared-types';

export type MockResponder = (input: GenerateTextInput) => string;

export class MockProvider implements AIProvider {
  readonly id = 'mock' as const;
  readonly supportsStructuredOutput = true;
  public calls: GenerateTextInput[] = [];

  constructor(
    private readonly responder: MockResponder,
    private readonly promptVersion = 'mock-1',
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    this.calls.push(input);
    return {
      text: this.responder(input),
      provider: this.id,
      model: 'mock-model',
      promptVersion: this.promptVersion,
      latencyMs: 1,
    };
  }

  async generateStructured<T>(
    input: GenerateStructuredInput<T>,
  ): Promise<GenerateStructuredResult<T>> {
    const result = await this.generateText(input);
    const parsed = input.schema.parse(JSON.parse(result.text));
    return { ...result, data: parsed, raw: result.text };
  }
}

/** Default responder: echoes a valid, schema-shaped placeholder per task. */
export function defaultMockResponder(input: GenerateTextInput): string {
  switch (input.task) {
    case 'job_semantic_match':
      return JSON.stringify({
        score: 0.6,
        rationale: 'Mock semantic assessment for local development.',
        matchedThemes: [],
        gaps: [],
      });
    case 'resume_tailor':
    case 'cover_letter':
      return JSON.stringify({ headline: 'Mock document', summary: 'Mock summary', sections: [] });
    default:
      return JSON.stringify({ ok: true });
  }
}
