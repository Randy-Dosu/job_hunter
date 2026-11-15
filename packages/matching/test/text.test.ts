import { describe, expect, it } from 'vitest';
import {
  annualize,
  canonicalSkill,
  containsTerm,
  extractCertifications,
  extractSkills,
  extractYearsRequired,
  jaccardSimilarity,
  normalizeText,
  parseSalaryRange,
  stem,
  tokenize,
} from '../src/index.js';

describe('normalisation', () => {
  it('strips diacritics, punctuation and casing', () => {
    expect(normalizeText('  Développeur  Sénior — C++ / .NET ')).toBe(
      'developpeur senior c++ / .net',
    );
  });

  it('tokenises and drops stop words', () => {
    const tokens = tokenize('We are looking for a Senior Backend Engineer with experience in AWS');
    expect(tokens).not.toContain('we');
    expect(tokens).not.toContain('experience');
    expect(tokens).toContain('senior');
    expect(tokens).toContain('aws');
  });

  it('canonicalises common technology spellings', () => {
    expect(canonicalSkill('Node.js')).toBe('nodejs');
    expect(canonicalSkill('NodeJS')).toBe('nodejs');
    expect(canonicalSkill('React.js')).toBe('react');
    expect(canonicalSkill('JS')).toBe(canonicalSkill('JavaScript'));
    expect(canonicalSkill('.NET')).toBe('dotnet');
    expect(canonicalSkill('C#')).toBe('csharp');
    expect(canonicalSkill('C++')).toBe('cpp');
  });

  it('stems simple inflections', () => {
    expect(stem('engineering')).toBe('engineer');
    expect(stem('developed')).toBe('develop');
    expect(stem('cat')).toBe('cat');
  });

  it('computes symmetric jaccard similarity', () => {
    const a = 'backend engineer typescript node';
    const b = 'backend engineer typescript';
    expect(jaccardSimilarity(a, b)).toBeCloseTo(jaccardSimilarity(b, a), 5);
    expect(jaccardSimilarity(a, a)).toBe(1);
    expect(jaccardSimilarity(a, 'registered nurse theatre')).toBe(0);
  });

  it('matches whole terms only', () => {
    expect(containsTerm('We use Go and Rust', 'go')).toBe(true);
    expect(containsTerm('We use algorithms daily', 'go')).toBe(false);
    expect(containsTerm('React, Vue and Svelte', 'react')).toBe(true);
  });
});

describe('skill extraction', () => {
  it('finds canonical skills from free text', () => {
    const skills = extractSkills(
      'Must know TypeScript, React, PostgreSQL, Kubernetes, Terraform and CI/CD. Nice to have: Rust.',
    );
    expect(skills).toEqual(
      expect.arrayContaining([
        'typescript',
        'react',
        'sql',
        'kubernetes',
        'terraform',
        'cicd',
        'rust',
      ]),
    );
  });

  it('does not confuse short tokens with substrings', () => {
    // "ai" must not be found inside "email"; "go" must not be found in "algorithms".
    const skills = extractSkills('Handle email and algorithms carefully.');
    expect(skills).not.toContain('ai/llm');
    expect(skills).not.toContain('go');
  });

  it('extracts named certifications', () => {
    expect(
      extractCertifications('CISSP or Security+ plus AWS Certified Solutions Architect'),
    ).toEqual(expect.arrayContaining(['cissp', 'security+', 'aws certified']));
  });

  it('parses years-of-experience requirements in several phrasings', () => {
    expect(extractYearsRequired('5+ years of experience required')).toBe(5);
    expect(extractYearsRequired('Minimum of 3 years in backend roles')).toBe(3);
    expect(extractYearsRequired('You have 4-6 years experience')).toBe(4);
    expect(extractYearsRequired('A senior role')).toBeUndefined();
  });
});

describe('salary parsing', () => {
  it('parses ranges with currency and period', () => {
    const usd = parseSalaryRange('$120,000 - $150,000 per year');
    expect(usd).toMatchObject({ min: 120_000, max: 150_000, currency: 'USD', period: 'year' });
  });

  it('expands k suffixes', () => {
    const gbp = parseSalaryRange('£60k – £80k annually');
    expect(gbp).toMatchObject({ min: 60_000, max: 80_000, currency: 'GBP' });
  });

  it('handles hourly rates', () => {
    const hourly = parseSalaryRange('€50 per hour');
    expect(hourly.period).toBe('hour');
    expect(hourly.currency).toBe('EUR');
  });

  it('returns currency/period even without numbers', () => {
    expect(parseSalaryRange('Competitive USD salary, annual')).toMatchObject({
      currency: 'USD',
      period: 'year',
    });
  });

  it('annualises all supported periods', () => {
    expect(annualize(50, 'hour')).toBe(104_000);
    expect(annualize(5_000, 'month')).toBe(60_000);
    expect(annualize(90_000, 'year')).toBe(90_000);
  });

  it('is safe on empty input', () => {
    expect(parseSalaryRange(undefined)).toEqual({});
    expect(parseSalaryRange('')).toEqual({});
  });
});
