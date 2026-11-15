/**
 * Shared synthetic fixtures. All names, companies and jobs are fictional.
 */

import type {
  CandidateProfileContent,
  JobPreferences,
  ProfileFact,
} from '@job-hunter/shared-types';
import { DEFAULT_JOB_PREFERENCES } from '@job-hunter/shared-types';

export function makePreferences(overrides: Partial<JobPreferences> = {}): JobPreferences {
  return {
    ...DEFAULT_JOB_PREFERENCES,
    targetTitles: ['Backend Engineer', 'Software Engineer'],
    targetKeywords: ['typescript', 'node'],
    enabledSources: ['remoteok'],
    ...overrides,
  };
}

export function makeProfile(
  overrides: Partial<CandidateProfileContent> = {},
): CandidateProfileContent {
  return {
    contact: { fullName: 'Ama Mensah', email: 'ama@example.test' },
    headline: 'Backend Engineer',
    summary: 'Backend engineer with 6 years building payment systems.',
    skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'AWS', 'Docker'],
    experience: [
      {
        company: 'Kente Pay',
        title: 'Senior Backend Engineer',
        startDate: '2020-03',
        current: true,
        bullets: ['Built TypeScript services handling payments', 'Led migration to PostgreSQL'],
        keywords: ['typescript', 'postgresql'],
      },
      {
        company: 'Accra Labs',
        title: 'Backend Engineer',
        startDate: '2018-01',
        endDate: '2020-02',
        bullets: ['Built REST APIs in Node.js'],
        keywords: ['node.js', 'rest'],
      },
    ],
    education: [
      {
        institution: 'Kwame Nkrumah University of Science and Technology',
        degree: 'BSc',
        field: 'Computer Science',
        endDate: '2017-06',
      },
    ],
    projects: [],
    certifications: [{ name: 'AWS Certified Solutions Architect', issuer: 'AWS' }],
    languages: ['English'],
    ...overrides,
  };
}

export function makeFacts(
  overrides: Array<Partial<ProfileFact> & Pick<ProfileFact, 'id' | 'label' | 'kind'>> = [],
): ProfileFact[] {
  const base: ProfileFact[] = [
    fact({ id: 'f1', kind: 'skill', label: 'TypeScript', keywords: ['typescript'] }),
    fact({ id: 'f2', kind: 'skill', label: 'Node.js', keywords: ['node.js', 'node'] }),
    fact({ id: 'f3', kind: 'skill', label: 'PostgreSQL', keywords: ['postgresql', 'sql'] }),
    fact({ id: 'f4', kind: 'skill', label: 'AWS', keywords: ['aws'] }),
    fact({ id: 'f5', kind: 'skill', label: 'Docker', keywords: ['docker'] }),
    fact({
      id: 'f6',
      kind: 'experience',
      label: 'Senior Backend Engineer at Kente Pay',
      detail:
        'Built TypeScript payment services; led a PostgreSQL migration; 40% latency reduction.',
      keywords: ['typescript', 'postgresql', 'payments'],
      organisation: 'Kente Pay',
      role: 'Senior Backend Engineer',
      startDate: '2020-03',
      verified: true,
    }),
    fact({
      id: 'f7',
      kind: 'experience',
      label: 'Backend Engineer at Accra Labs',
      detail: 'Built REST APIs with Node.js for a logistics platform.',
      keywords: ['node.js', 'rest'],
      organisation: 'Accra Labs',
      role: 'Backend Engineer',
      startDate: '2018-01',
      endDate: '2020-02',
      verified: true,
    }),
    fact({
      id: 'f8',
      kind: 'education',
      label: 'BSc Computer Science, KNUST',
      keywords: ['computer science'],
      organisation: 'KNUST',
      verified: true,
    }),
    fact({
      id: 'f9',
      kind: 'certification',
      label: 'AWS Certified Solutions Architect',
      keywords: ['aws'],
      organisation: 'AWS',
      verified: true,
    }),
  ];
  return [...base, ...overrides.map((item) => fact(item))] as ProfileFact[];
}

export function fact(
  overrides: Partial<ProfileFact> & { id: string; label: string; kind: ProfileFact['kind'] },
): ProfileFact {
  return {
    detail: undefined,
    keywords: [],
    source: 'manual',
    verified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ProfileFact;
}

export const STRONG_JOB = {
  id: 'job-strong',
  title: 'Senior Backend Engineer',
  company: 'Zola Systems',
  description: [
    'We are hiring a Senior Backend Engineer to build payment infrastructure.',
    'Requirements: 5+ years of experience with TypeScript, Node.js and PostgreSQL.',
    'You will work with AWS and Docker in a remote-first team.',
    'A bachelor degree in computer science or equivalent experience.',
  ].join(' '),
  tags: ['typescript', 'nodejs', 'postgresql'],
  location: { raw: 'Remote (Worldwide)', remote: true, workplace: 'remote' as const },
  employmentType: 'full_time' as const,
  seniority: 'senior' as const,
  salary: { min: 90_000, max: 130_000, currency: 'USD', period: 'year' as const },
  postedAt: '2026-11-10T09:00:00.000Z',
};

export const UNRELATED_JOB = {
  id: 'job-unrelated',
  title: 'Registered Nurse — Theatre',
  company: 'Cape Coast Clinic',
  description: [
    'Provide clinical nursing care in a theatre environment.',
    'Requires nursing registration, patient care experience and EMR familiarity (Epic).',
    'Onsite role, no remote work.',
  ].join(' '),
  tags: ['nursing', 'clinical'],
  location: {
    raw: 'Cape Coast, Ghana',
    remote: false,
    workplace: 'onsite' as const,
    countryCode: 'GH',
  },
  employmentType: 'full_time' as const,
  seniority: 'mid' as const,
  postedAt: '2026-11-09T09:00:00.000Z',
};

export const WEAK_BUT_RELEVANT_JOB = {
  id: 'job-weak',
  title: 'Staff Site Reliability Engineer',
  company: 'Kilima Cloud',
  description: [
    'Own reliability for a multi-region platform.',
    'Requires 10+ years experience, deep Kubernetes, Terraform, Go and Prometheus expertise.',
    'PhD preferred. CISSP certification required.',
  ].join(' '),
  tags: ['kubernetes', 'terraform', 'go'],
  location: {
    raw: 'Berlin, Germany',
    remote: false,
    workplace: 'onsite' as const,
    countryCode: 'DE',
  },
  employmentType: 'full_time' as const,
  seniority: 'principal' as const,
  postedAt: '2026-11-11T09:00:00.000Z',
};
