/**
 * Deterministic mock provider.
 *
 * Used by tests and by local development when no API keys are configured, so the
 * whole product works offline without pretending to be a real model. It is
 * clearly labelled (`provider: 'mock'`) everywhere it appears in UI data.
 *
 * The document tasks return a *plausible draft assembled only from the verified
 * facts in the prompt*, rather than an empty placeholder. This matters: a 2-word
 * document would make the demo, the UI and the evidence check look broken, and
 * a mock that fabricates content freely would hide evidence bugs. Everything the
 * responder emits is therefore traceable to a `id=...` line in the prompt.
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

interface MockFact {
  id: string;
  kind: string;
  label: string;
  detail?: string;
}

/** Parse the `- id=… | kind | label | detail` lines the tailor prompts emit. */
export function parsePromptFacts(prompt: string): MockFact[] {
  const facts: MockFact[] = [];
  for (const line of prompt.split('\n')) {
    const match = /^-\s+id=(\S+)\s+\|\s+([^|]+?)\s+\|\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    const [, id, kind, rest] = match;
    if (!id || !kind || !rest) continue;
    const [label, detail] = rest.split(' | ');
    facts.push({
      id,
      kind: kind.trim(),
      label: (label ?? '').trim(),
      ...(detail ? { detail: detail.trim() } : {}),
    });
  }
  return facts;
}

function readTag(prompt: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(prompt);
  return match?.[1]?.trim();
}

function readField(prompt: string, field: string): string | undefined {
  const match = new RegExp(`^${field}:\\s*(.+)$`, 'm').exec(prompt);
  return match?.[1]?.trim();
}

function titleCase(value: string): string {
  return value
    .split(' ')
    .map((word) => (word.length > 2 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/**
 * Build a resume draft from verified facts only. Grouping mirrors how a human
 * would order a resume, and every bullet cites the fact it came from.
 */
function mockResume(prompt: string): string {
  const facts = parsePromptFacts(prompt);
  const jobTitle = readField(prompt, 'Title') ?? 'the role';
  const company = readField(prompt, 'Company') ?? 'the company';
  const baseSummary = readTag(prompt, 'base_summary');

  const byKind = (kind: string): MockFact[] => facts.filter((fact) => fact.kind === kind);
  const experience = byKind('experience');
  const skills = byKind('skill');
  const education = [...byKind('education'), ...byKind('certification')];
  const projects = byKind('project');

  const sections: Array<{ heading: string; bullets: string[]; evidenceIds: string[] }> = [];

  const experienceBullets = experience.map((fact) => fact.detail ?? fact.label).slice(0, 6);
  if (experienceBullets.length > 0) {
    sections.push({
      heading: 'Experience',
      bullets: experienceBullets,
      evidenceIds: experience.slice(0, 6).map((fact) => fact.id),
    });
  }

  if (skills.length > 0) {
    sections.push({
      heading: 'Skills',
      bullets: [
        skills
          .slice(0, 12)
          .map((fact) => fact.label)
          .join(' · '),
      ],
      evidenceIds: skills.slice(0, 12).map((fact) => fact.id),
    });
  }

  if (projects.length > 0) {
    sections.push({
      heading: 'Projects',
      bullets: projects
        .slice(0, 4)
        .map((fact) => `${fact.label} — ${fact.detail ?? 'See portfolio.'}`),
      evidenceIds: projects.slice(0, 4).map((fact) => fact.id),
    });
  }

  if (education.length > 0) {
    sections.push({
      heading: 'Education',
      bullets: education.map((fact) => fact.label),
      evidenceIds: education.map((fact) => fact.id),
    });
  }

  const summary = [
    baseSummary?.trim(),
    `Targeting ${jobTitle} at ${company}, using only the experience verified below.`,
  ]
    .filter(Boolean)
    .join(' ');

  return JSON.stringify({
    headline: baseSummary ? summary.split('. ')[0] : `${jobTitle} candidate`,
    summary,
    sections,
  });
}

/**
 * A short letter whose every sentence restates a listed fact.
 *
 * Deliberately written in the first person *without* "at/with/for <Capitalised
 * Name>" phrasing or new figures: the evidence checker treats such names as
 * claims about the candidate's employers, and this mock must never trip its own
 * truthfulness gate. The company and role are named only as "your" team/role.
 */
function mockCoverLetter(prompt: string): string {
  const facts = parsePromptFacts(prompt);
  const role = readField(prompt, 'Title');

  const experience = facts.find((fact) => fact.kind === 'experience');
  const skills = facts
    .filter((fact) => fact.kind === 'skill')
    .slice(0, 4)
    .map((fact) => fact.label);

  const opening = role
    ? `I would like to be considered for your ${role} opening.`
    : 'I would like to be considered for this opening.';
  const middle = experience?.detail ?? experience?.label;
  const closing = skills.length
    ? `My day-to-day tools are ${skills.join(', ')}. I would welcome the chance to discuss how that experience maps to your requirements.`
    : 'I would welcome the chance to discuss how my experience maps to your requirements.';

  return JSON.stringify({
    headline: role ? `${titleCase(role)} application` : 'Application',
    summary: [opening, middle, closing].filter(Boolean).join(' '),
    sections: [
      {
        heading: 'Summary',
        bullets: [opening, closing],
        evidenceIds: facts.slice(0, 6).map((fact) => fact.id),
      },
    ],
  });
}

function documentsFallback(input: GenerateTextInput): string | undefined {
  if (input.task === 'resume_tailor') return mockResume(input.prompt);
  if (input.task === 'cover_letter') return mockCoverLetter(input.prompt);
  return undefined;
}

/** Default responder: schema-shaped output derived from the prompt's own data. */
export function defaultMockResponder(input: GenerateTextInput): string {
  const documents = documentsFallback(input);
  if (documents) return documents;

  switch (input.task) {
    case 'job_semantic_match':
      return JSON.stringify({
        score: 0.6,
        rationale: 'Mock semantic assessment for local development.',
        matchedThemes: [],
        gaps: [],
      });
    case 'resume_parse_extract':
      return JSON.stringify({ facts: [] });
    default:
      return JSON.stringify({ ok: true });
  }
}
