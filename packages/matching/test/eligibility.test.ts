import { describe, expect, it } from 'vitest';
import { evaluateEligibility, evaluateSalaryEligibility } from '../src/index.js';
import { makePreferences } from './fixtures.js';

const baseJob = {
  title: 'Backend Engineer',
  company: 'Zola Systems',
  location: { raw: 'Remote', remote: true, workplace: 'remote' as const },
  employmentType: 'full_time' as const,
  seniority: 'mid' as const,
  tags: ['typescript'],
  description: 'Build services.',
};

describe('evaluateEligibility — hard filters', () => {
  it('passes a job that matches every preference', () => {
    const result = evaluateEligibility({ job: baseJob, preferences: makePreferences() });
    expect(result.eligible).toBe(true);
    expect(result.failedRules).toEqual([]);
  });

  it('rejects excluded keywords found in the title or tags', () => {
    const result = evaluateEligibility({
      job: { ...baseJob, title: 'Senior PHP Developer' },
      preferences: makePreferences({ excludedKeywords: ['php'] }),
    });
    expect(result.eligible).toBe(false);
    expect(result.failedRules).toContain('excluded_keyword');
    expect(result.reasons[0]).toContain('php');
  });

  it('does not reject on excluded keywords that only appear in the description', () => {
    const result = evaluateEligibility({
      job: { ...baseJob, description: 'We also use PHP somewhere in the stack.' },
      preferences: makePreferences({ excludedKeywords: ['php'] }),
    });
    expect(result.eligible).toBe(true);
  });

  it('rejects excluded companies case-insensitively', () => {
    const result = evaluateEligibility({
      job: { ...baseJob, company: 'Zola Systems Ltd' },
      preferences: makePreferences({ excludedCompanies: ['zola systems'] }),
    });
    expect(result.eligible).toBe(false);
    expect(result.failedRules).toContain('excluded_company');
  });

  it('enforces remote-only when a listing is onsite', () => {
    const result = evaluateEligibility({
      job: {
        ...baseJob,
        location: {
          raw: 'Cape Coast, Ghana',
          remote: false,
          workplace: 'onsite',
          countryCode: 'GH',
        },
      },
      preferences: makePreferences({ remoteOnly: true }),
    });
    expect(result.eligible).toBe(false);
    expect(result.failedRules).toContain('remote_required');
  });

  it('treats unknown work modes as not confirmed remote', () => {
    const result = evaluateEligibility({
      job: { ...baseJob, location: { raw: 'Ghana', workplace: 'unknown' } },
      preferences: makePreferences({ remoteOnly: true }),
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/not confirmed remote/i);
  });

  it('only applies country filters when the job country is known', () => {
    const unknownCountry = evaluateEligibility({
      job: { ...baseJob, location: { raw: 'Somewhere', workplace: 'unknown' } },
      preferences: makePreferences({ countryCodes: ['GH'] }),
    });
    expect(unknownCountry.eligible).toBe(true);

    const wrongCountry = evaluateEligibility({
      job: {
        ...baseJob,
        location: { raw: 'Berlin, Germany', countryCode: 'DE', workplace: 'onsite' },
      },
      preferences: makePreferences({ countryCodes: ['GH'] }),
    });
    expect(wrongCountry.eligible).toBe(false);
    expect(wrongCountry.failedRules).toContain('country');
  });

  it('reports every failing rule, not just the first', () => {
    const result = evaluateEligibility({
      job: {
        title: 'Night Shift Nurse',
        company: 'Cape Coast Clinic',
        location: { raw: 'Cape Coast', countryCode: 'GH', workplace: 'onsite' },
        employmentType: 'part_time',
        seniority: 'junior',
        tags: ['nursing'],
        description: 'Clinical work.',
      },
      preferences: makePreferences({
        excludedKeywords: ['nurse'],
        remoteOnly: true,
        employmentTypes: ['full_time'],
        seniorityLevels: ['senior'],
      }),
    });
    expect(result.eligible).toBe(false);
    expect(new Set(result.failedRules)).toEqual(
      new Set(['excluded_keyword', 'remote_required', 'employment_type', 'seniority']),
    );
  });

  it('applies salary floors only when a comparable number exists', () => {
    const below = evaluateSalaryEligibility({
      salaryMinAnnual: 40_000,
      preferences: makePreferences({ minSalary: 60_000 }),
    });
    expect(below.failed).toBe(true);

    const unknown = evaluateSalaryEligibility({
      preferences: makePreferences({ minSalary: 60_000 }),
    });
    expect(unknown.failed).toBe(false);
  });
});
