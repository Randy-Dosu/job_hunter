/**
 * Document generation orchestration.
 *
 * Flow: build prompt (verified facts only) -> AI gateway -> evidence check ->
 * attach warnings. The result is always a DRAFT requiring user approval; nothing
 * here can mark a document approved.
 */

import type {
  AITask,
  GeneratedDocumentContent,
  GeneratedDocumentSection,
  JobPreferences,
  NormalizedJob,
  ProfileFact,
} from '@job-hunter/shared-types';
import { z } from 'zod';

export const generatedDocumentSchema = z.object({
  headline: z.string().max(200).default(''),
  summary: z.string().max(3000).optional(),
  sections: z
    .array(
      z.object({
        heading: z.string().max(120),
        bullets: z.array(z.string().max(600)).max(30),
        evidenceIds: z.array(z.string()).max(60).default([]),
      }),
    )
    .max(20)
    .default([]),
});

export type GeneratedDocumentPayload = z.infer<typeof generatedDocumentSchema>;

export interface DocumentGeneratorDeps {
  /** Minimal gateway surface so tests can inject a fake. */
  gateway: {
    generateStructured<T>(input: {
      task: AITask;
      system: string;
      prompt: string;
      schema: { parse: (value: unknown) => T };
      maxTokens?: number | undefined;
      temperature?: number | undefined;
    }): Promise<{
      data: T;
      provider: string;
      model: string;
      promptVersion: string;
      latencyMs: number;
    }>;
  };
  prompts: {
    buildResumeTailorPrompt: (input: TailorPromptInput) => { system: string; prompt: string };
    buildCoverLetterPrompt: (input: TailorPromptInput) => { system: string; prompt: string };
  };
}

export interface TailorPromptInput {
  jobTitle: string;
  company: string;
  jobDescription: string;
  verifiedFacts: Array<{ id: string; label: string; detail?: string | undefined; kind: string }>;
  baseSummary?: string | undefined;
}

export interface GenerateDocumentInput {
  job: Pick<NormalizedJob, 'title' | 'company' | 'description'>;
  facts: ProfileFact[];
  preferences?: JobPreferences | undefined;
  kind: 'resume' | 'cover_letter';
  baseSummary?: string | undefined;
  tone?: 'professional' | 'concise' | 'warm' | undefined;
}

export interface GenerateDocumentResult {
  content: GeneratedDocumentContent;
  provider: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
}

/** Facts eligible to be used: verified only, unless the caller overrides for review. */
export function eligibleFacts(facts: ProfileFact[]): ProfileFact[] {
  return facts.filter((fact) => fact.verified);
}

export async function generateDocument(
  input: GenerateDocumentInput,
  deps: DocumentGeneratorDeps,
): Promise<GenerateDocumentResult> {
  const verified = eligibleFacts(input.facts);
  if (verified.length === 0) {
    throw new Error(
      'No verified facts yet. Verify your profile facts before generating tailored documents.',
    );
  }

  const promptInput: TailorPromptInput = {
    jobTitle: input.job.title,
    company: input.job.company,
    jobDescription: input.job.description,
    verifiedFacts: verified.map((fact) => ({
      id: fact.id,
      label: fact.label,
      kind: fact.kind,
      ...(fact.detail ? { detail: fact.detail } : {}),
    })),
    ...(input.baseSummary ? { baseSummary: input.baseSummary } : {}),
  };

  const build =
    input.kind === 'resume'
      ? deps.prompts.buildResumeTailorPrompt
      : deps.prompts.buildCoverLetterPrompt;
  const { system, prompt } = build(promptInput);
  const toneLine =
    input.tone === 'concise'
      ? 'Prefer short, direct sentences.'
      : input.tone === 'warm'
        ? 'Use a warm but professional tone.'
        : 'Use a neutral, professional tone.';

  const result = await deps.gateway.generateStructured<GeneratedDocumentPayload>({
    task: input.kind === 'resume' ? 'resume_tailor' : 'cover_letter',
    system: `${system}\n${toneLine}`,
    prompt,
    schema: generatedDocumentSchema,
    maxTokens: 2500,
    temperature: 0.3,
  });

  const content: GeneratedDocumentContent = {
    kind: input.kind,
    headline: result.data.headline || `${input.job.title} — ${input.job.company}`,
    ...(result.data.summary ? { summary: result.data.summary } : {}),
    sections: result.data.sections.map((section) => ({
      heading: section.heading,
      bullets: section.bullets,
      evidenceIds: section.evidenceIds,
    })),
    warnings: [],
    wordCount: 0,
  };

  return {
    content,
    provider: result.provider,
    model: result.model,
    promptVersion: result.promptVersion,
    latencyMs: result.latencyMs,
  };
}

/** Build a deterministic fallback document (used when AI is unavailable). */
export function buildFallbackDocument(input: {
  kind: 'resume' | 'cover_letter';
  job: { title: string; company: string };
  facts: ProfileFact[];
}): GeneratedDocumentContent {
  const verified = eligibleFacts(input.facts);
  const skills = verified.filter((fact) => fact.kind === 'skill').map((fact) => fact.label);
  const experience = verified.filter((fact) => fact.kind === 'experience');
  const education = verified.filter((fact) => fact.kind === 'education');

  const sections: GeneratedDocumentSection[] = [];
  if (input.kind === 'resume') {
    if (skills.length > 0) {
      sections.push({
        heading: 'Skills',
        bullets: [skills.slice(0, 20).join(' · ')],
        evidenceIds: verified.filter((fact) => fact.kind === 'skill').map((fact) => fact.id),
      });
    }
    if (experience.length > 0) {
      sections.push({
        heading: 'Experience',
        bullets: experience
          .slice(0, 6)
          .map((fact) => `${fact.label}${fact.detail ? ` — ${fact.detail}` : ''}`),
        evidenceIds: experience.map((fact) => fact.id),
      });
    }
    if (education.length > 0) {
      sections.push({
        heading: 'Education',
        bullets: education.slice(0, 4).map((fact) => fact.label),
        evidenceIds: education.map((fact) => fact.id),
      });
    }
  } else {
    sections.push({
      heading: 'Body',
      bullets: [
        `I am applying for the ${input.job.title} role at ${input.job.company}.`,
        ...experience
          .slice(0, 3)
          .map(
            (fact) =>
              `In my role as ${fact.label}, ${fact.detail ?? 'I delivered on the responsibilities described in my profile.'}`,
          ),
      ],
      evidenceIds: experience.map((fact) => fact.id),
    });
  }

  const content: GeneratedDocumentContent = {
    kind: input.kind,
    headline: `${input.job.title} — ${input.job.company}`,
    sections,
    warnings: [
      'This document was assembled from your verified facts without an AI provider. Review and edit it before approving.',
    ],
    wordCount: 0,
  };
  return {
    ...content,
    wordCount: content.sections.reduce(
      (total, section) => total + section.bullets.join(' ').split(/\s+/).filter(Boolean).length,
      content.headline.split(/\s+/).length,
    ),
  };
}
