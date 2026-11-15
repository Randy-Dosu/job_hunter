import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  SCORING_VERSION,
  estimateYears,
  normalizeWeights,
  scoreJob,
  summarizeMatch,
  toBand,
} from '../src/index.js';
import {
  STRONG_JOB,
  UNRELATED_JOB,
  WEAK_BUT_RELEVANT_JOB,
  makeFacts,
  makePreferences,
  makeProfile,
} from './fixtures.js';

const baseInput = () => ({
  job: STRONG_JOB,
  profile: makeProfile(),
  verifiedFacts: makeFacts(),
  preferences: makePreferences(),
});

describe('scoreJob — determinism and shape', () => {
  it('is repeatable for identical inputs', () => {
    const a = scoreJob(baseInput());
    const b = scoreJob(baseInput());
    expect(a.score).toBe(b.score);
    expect(a.components).toEqual(b.components);
    expect(a.gaps).toEqual(b.gaps);
  });

  it('produces a 0-100 integer score with a band', () => {
    const result = scoreJob(baseInput());
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(['strong', 'good', 'fair', 'weak']).toContain(result.band);
    expect(result.scoringVersion).toBe(SCORING_VERSION);
    expect(result.profileVersion).toMatch(/^pf_[0-9a-f]{8}$/);
  });

  it('includes every dimension in the breakdown with weights summing to 100%', () => {
    const result = scoreJob(baseInput());
    const dimensions = result.components.map((component) => component.dimension).sort();
    expect(dimensions).toEqual([
      'education',
      'experience',
      'location',
      'preferences',
      'role',
      'skills',
    ]);

    const totalWeight = result.components.reduce((sum, component) => sum + component.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 3);

    const totalPoints = result.components.reduce((sum, component) => sum + component.points, 0);
    // Points are the weighted contributions; their sum is the raw score.
    expect(Math.round(totalPoints)).toBe(result.score);
  });

  it('ignores unverified facts entirely (no evidence, no score inflation)', () => {
    const unverified = makeFacts().map((item) => ({ ...item, verified: false }));
    // Also clear the structured profile history: verified facts are the only
    // source of *evidence*, and this scenario has none.
    const withUnverified = scoreJob({
      ...baseInput(),
      verifiedFacts: unverified,
      profile: makeProfile({ experience: [] }),
    });

    // The experience dimension cannot be scored from unverified history: it is
    // reported as unknown and excluded from the weighted total (renormalisation),
    // rather than being counted as a deficiency.
    const experience = withUnverified.components.find(
      (component) => component.dimension === 'experience',
    );
    expect(experience?.score).toBeNull();
    expect(experience?.unknowns.join(' ')).toMatch(
      /no work history found in your verified profile/i,
    );
    expect(experience?.effectiveWeight).toBe(0);

    // No evidence entry may be supported by a fact that is not verified.
    const unverifiedLabels = new Set(unverified.map((item) => item.label));
    for (const entry of withUnverified.evidence) {
      expect(unverifiedLabels.has(entry.factLabel)).toBe(false);
    }
  });
});

describe('scoreJob — relative ranking', () => {
  it('ranks a matching job above an unrelated one', () => {
    const strong = scoreJob(baseInput());
    const unrelated = scoreJob({ ...baseInput(), job: UNRELATED_JOB });
    expect(strong.score).toBeGreaterThan(unrelated.score + 20);
    expect(strong.band).toBe('strong');
    expect(unrelated.band).toBe('weak');
  });

  it('identifies concrete gaps for a job that asks for more', () => {
    const weak = scoreJob({ ...baseInput(), job: WEAK_BUT_RELEVANT_JOB });
    const missing = weak.gaps.filter((gap) => gap.kind === 'missing_evidence');
    expect(missing.length).toBeGreaterThan(0);
    const requirements = weak.gaps.map((gap) => gap.requirement.toLowerCase());
    expect(requirements.some((req) => req.includes('kubernetes'))).toBe(true);
    const yearsGap = weak.gaps.find((gap) => gap.requirement.includes('years'));
    expect(yearsGap).toBeDefined();
  });

  it('labels missing information as unknown rather than a deficiency', () => {
    const result = scoreJob({
      ...baseInput(),
      verifiedFacts: [],
      profile: makeProfile({ experience: [], skills: [], education: [], certifications: [] }),
    });
    const experience = result.components.find((component) => component.dimension === 'experience');
    expect(experience?.score).toBeNull();
    expect(experience?.unknowns.join(' ')).toMatch(/no work history|unknown/i);
    const unknownGaps = result.gaps.filter((gap) => gap.kind === 'unknown');
    expect(unknownGaps.length).toBeGreaterThan(0);
  });
});

describe('scoreJob — semantic blending is explicit', () => {
  it('records that semantic review was used and blends the affected dimensions', () => {
    const deterministic = scoreJob(baseInput());
    const semantic = scoreJob({
      ...baseInput(),
      semantic: {
        score: 0.2,
        rationale: 'The posting is mostly infrastructure work.',
        matchedThemes: [],
        gaps: ['Kubernetes'],
      },
    });

    expect(semantic.usedSemantic).toBe(true);
    expect(deterministic.usedSemantic).toBe(false);
    expect(semantic.score).toBeLessThan(deterministic.score);

    const skills = semantic.components.find((component) => component.dimension === 'skills');
    expect(skills?.rationale).toContain('Semantic review');
    expect(semantic.gaps.some((gap) => gap.requirement === 'Kubernetes')).toBe(true);
  });
});

describe('weights and helpers', () => {
  it('renormalises custom weights to 100%', () => {
    const weights = normalizeWeights({ ...DEFAULT_WEIGHTS, skills: 60 });
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(100, 5);
    expect(weights.skills).toBeGreaterThan(DEFAULT_WEIGHTS.skills);
  });

  it('maps scores onto bands at the documented thresholds', () => {
    expect(toBand(80)).toBe('strong');
    expect(toBand(79)).toBe('good');
    expect(toBand(65)).toBe('good');
    expect(toBand(64)).toBe('fair');
    expect(toBand(45)).toBe('fair');
    expect(toBand(44)).toBe('weak');
  });

  it('estimates total experience from verified facts, merging overlaps', () => {
    const years = estimateYears(
      makeFacts().filter((item) => item.kind === 'experience'),
      makeProfile(),
    );
    // 2018-01 through a current role in 2026 is ~8 years; must be plausible.
    expect(years).toBeGreaterThan(5);
    expect(years).toBeLessThan(12);
  });

  it('returns undefined years when no dates are known', () => {
    expect(estimateYears([], makeProfile({ experience: [] }))).toBeUndefined();
  });
});

/**
 * Regressions from the live-API sweep.
 *
 * A brand-new account with no verified facts used to score 48/"fair" — the
 * education dimension awarded 0.6 for a posting that did not ask for a degree,
 * and a number on screen reads as a judgement even when nothing is known.
 */
describe('scoreJob — no evidence must never look like a judgement', () => {
  const emptyProfile = () =>
    makeProfile({ skills: [], experience: [], education: [], certifications: [], summary: '' });

  it('flags an empty profile as not scoreable instead of bands it', () => {
    const result = scoreJob({
      job: STRONG_JOB,
      profile: emptyProfile(),
      verifiedFacts: [],
      preferences: makePreferences(),
    });
    expect(result.scoreable).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThan(45);
    expect(result.band).toBe('weak');
    // The UI relies on this note to explain the missing number.
    expect((result as { note?: string }).note).toMatch(/not enough verified profile information/i);
  });

  it('never awards education points when the candidate listed no education', () => {
    const result = scoreJob({
      job: STRONG_JOB,
      profile: emptyProfile(),
      verifiedFacts: [],
      preferences: makePreferences(),
    });
    const education = result.components.find((row) => row.dimension === 'education');
    expect(education).toBeDefined();
    // Either genuinely absent (null, renormalised out) or a real comparison —
    // never a made-up 0.6 "near miss" for a candidate with no education at all.
    expect(education?.score === null || (education?.score ?? 1) < 0.6).toBe(true);
  });

  it('marks a match scoreable as soon as one verified dimension has evidence', () => {
    const result = scoreJob({
      job: STRONG_JOB,
      profile: emptyProfile(),
      verifiedFacts: makeFacts().filter((item) => item.kind === 'skill'),
      preferences: makePreferences(),
    });
    expect(result.scoreable).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('keeps a fully evidenced match scoreable', () => {
    expect(scoreJob(baseInput()).scoreable).toBe(true);
  });
});

describe('summarizeMatch — no evidence, no verdict', () => {
  it('does not imply the candidate fell short when nothing is known', () => {
    const result = scoreJob({
      job: STRONG_JOB,
      profile: makeProfile({ skills: [], experience: [], education: [], certifications: [] }),
      verifiedFacts: [],
      preferences: makePreferences(),
    });
    expect(summarizeMatch(result)).toMatch(/not enough verified information/i);
    expect(summarizeMatch(result)).not.toMatch(/not evidenced/);
  });

  it('still summarises strong dimensions when evidence exists', () => {
    const summary = summarizeMatch(scoreJob(baseInput()));
    expect(summary).not.toMatch(/not enough verified information/i);
    expect(summary.length).toBeGreaterThan(0);
  });
});
