/**
 * The mock provider is used for local development and by the API test harness,
 * so it must produce *usable, truthful* output — not a placeholder. These tests
 * pin the two properties that matter:
 *
 *   1. Document drafts contain content built only from the facts in the prompt.
 *   2. Every cited evidence id exists in the prompt (so the evidence checker and
 *      the "unsupported claim" path are exercised, not bypassed).
 */

import { describe, expect, it } from 'vitest';
import { defaultMockResponder, parsePromptFacts } from '../src/mock-provider.js';

const FACTS = [
  {
    id: 'fact-1',
    kind: 'experience',
    label: 'Senior Backend Engineer at Kumasi Freight',
    detail: 'Rebuilt the dispatch API in Node.js and PostgreSQL.',
  },
  { id: 'fact-2', kind: 'skill', label: 'TypeScript' },
  { id: 'fact-3', kind: 'skill', label: 'PostgreSQL' },
  { id: 'fact-4', kind: 'education', label: 'BSc Computer Science, KNUST' },
];

function tailorPrompt(): string {
  return [
    '<verified_facts>',
    ...FACTS.map(
      (fact) =>
        `- id=${fact.id} | ${fact.kind} | ${fact.label}${fact.detail ? ` | ${fact.detail}` : ''}`,
    ),
    '</verified_facts>',
    '<base_summary>Backend engineer focused on payments.</base_summary>',
    '<untrusted_job_posting>',
    'Title: Senior Backend Engineer',
    'Company: Northwind Pay',
    'We need TypeScript and PostgreSQL experience.',
    '</untrusted_job_posting>',
  ].join('\n');
}

describe('parsePromptFacts', () => {
  it('reads id, kind, label and detail from prompt lines', () => {
    const facts = parsePromptFacts(tailorPrompt());
    expect(facts).toHaveLength(4);
    expect(facts[0]).toMatchObject({
      id: 'fact-1',
      kind: 'experience',
      label: 'Senior Backend Engineer at Kumasi Freight',
      detail: 'Rebuilt the dispatch API in Node.js and PostgreSQL.',
    });
    expect(facts[1]?.detail).toBeUndefined();
  });

  it('ignores lines that are not facts', () => {
    expect(parsePromptFacts('Title: Something\n- not a fact line')).toEqual([]);
  });
});

describe('mock document drafts', () => {
  const resume = (): {
    headline: string;
    summary: string;
    sections: Array<{ heading: string; bullets: string[]; evidenceIds: string[] }>;
  } =>
    JSON.parse(
      defaultMockResponder({ task: 'resume_tailor', system: '', prompt: tailorPrompt() }),
    ) as never;

  it('produces a resume with real sections instead of a placeholder', () => {
    const draft = resume();
    expect(draft.headline.length).toBeGreaterThan(3);
    expect(draft.sections.length).toBeGreaterThanOrEqual(3);
    expect(draft.sections.map((section) => section.heading)).toEqual([
      'Experience',
      'Skills',
      'Education',
    ]);

    const words = [
      draft.headline,
      draft.summary,
      ...draft.sections.flatMap((section) => section.bullets),
    ]
      .join(' ')
      .split(/\s+/)
      .filter(Boolean);
    expect(words.length).toBeGreaterThan(20);
  });

  it('cites only evidence ids that exist in the prompt', () => {
    const ids = new Set(FACTS.map((fact) => fact.id));
    for (const section of resume().sections) {
      for (const id of section.evidenceIds) expect(ids.has(id)).toBe(true);
      expect(section.evidenceIds.length).toBeGreaterThan(0);
    }
  });

  it('never invents an employer, skill or degree that is not in the facts', () => {
    const text = JSON.stringify(resume()).toLowerCase();
    for (const claim of ['google', 'amazon', 'meta', 'stanford', 'phd', 'mba', 'kubernetes']) {
      expect(text).not.toContain(claim);
    }
    // …while facts that *are* provided do appear.
    expect(text).toContain('postgresql');
    expect(text).toContain('knust');
  });

  it('writes a multi-sentence cover letter grounded in the facts', () => {
    const letter = JSON.parse(
      defaultMockResponder({ task: 'cover_letter', system: '', prompt: tailorPrompt() }),
    ) as { summary: string; headline: string };
    expect(letter.summary.split(/[.!?] /).length).toBeGreaterThanOrEqual(3);
    // Names the role, never a new employer (the evidence gate would flag that).
    expect(letter.summary).toContain('Senior Backend Engineer');
    expect(letter.headline.toLowerCase()).toContain('backend');
  });

  it('handles a prompt with no facts without throwing', () => {
    const empty = defaultMockResponder({
      task: 'resume_tailor',
      system: '',
      prompt: 'Title: Engineer\nCompany: Acme',
    });
    const draft = JSON.parse(empty) as { sections: unknown[] };
    expect(Array.isArray(draft.sections)).toBe(true);
  });

  it('keeps the semantic-match shape for the matching task', () => {
    const result = JSON.parse(
      defaultMockResponder({ task: 'job_semantic_match', system: '', prompt: '' }),
    ) as { score: number; rationale: string };
    expect(result.score).toBeGreaterThan(0);
    expect(result.rationale).toContain('Mock');
  });
});
