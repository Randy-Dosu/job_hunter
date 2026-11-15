/**
 * Demo seed.
 *
 * Creates one account with a *realistic but entirely fictional* candidate, ten
 * listings across permitted sources, real matches computed by the real scoring
 * engine, one generated document pair and a small application history.
 *
 * Two rules this script follows deliberately:
 *   1. It writes through the same packages the API uses (scoring, document
 *      engine, auth hashing) so seeded data cannot diverge from production data.
 *   2. It never marks a job `applied` on the user's behalf *without* saying so in
 *      the UI — every seeded application is a record the demo user could have
 *      created by hand.
 *
 *   npm run seed            # idempotent: re-running updates, never duplicates
 *   npm run seed -- --reset # delete the demo user and start over
 */

import { loadEnv } from '@job-hunter/config';
import {
  DEFAULT_JOB_PREFERENCES,
  type CandidateProfileContent,
  type JobPreferences,
  type NormalizedJob,
  type ProfileFact,
} from '@job-hunter/shared-types';
import { scoreJob, buildProfileVersion } from '@job-hunter/matching';
import { SOURCE_REGISTER } from '@job-hunter/job-connectors';
import { createDatabase } from '../apps/api/src/db/client.js';
import { AuthService } from '../apps/api/src/services/auth-service.js';
import { createLogger } from '../apps/api/src/lib/logger.js';

const DEMO_EMAIL = 'demo@job-hunter.dev';
const DEMO_PASSWORD = 'demo-password-please-change';

const env = loadEnv({
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  DATABASE_URL:
    process.env.DATABASE_URL ??
    `postgresql://postgres:postgres@127.0.0.1:${process.env.PGLITE_PORT ?? '5432'}/postgres`,
} as NodeJS.ProcessEnv);

const logger = createLogger({ level: 'info' });
const db = createDatabase({ connectionString: env.DATABASE_URL });
const now = Date.now();
const daysAgo = (days: number): Date => new Date(now - days * 86_400_000);

// ---------------------------------------------------------------- candidates

const PROFILE: CandidateProfileContent = {
  contact: {
    fullName: 'Ama Mensah',
    email: DEMO_EMAIL,
    phone: '+233 20 000 0000',
    location: 'Kumasi, Ghana',
    linkedin: 'https://www.linkedin.com/in/example-ama',
    github: 'https://github.com/example-ama',
  },
  headline: 'Senior Backend Engineer',
  summary:
    'Backend engineer with six years building payment and logistics systems in TypeScript, Node.js and PostgreSQL.',
  skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'AWS', 'Docker', 'REST APIs', 'React'],
  experience: [
    {
      company: 'Kumasi Freight',
      title: 'Senior Backend Engineer',
      startDate: '2022-03',
      current: true,
      location: 'Kumasi, Ghana',
      bullets: [
        'Rebuilt the dispatch API in Node.js and PostgreSQL, cutting p95 latency from 1.4s to 180ms.',
        'Introduced containerised deployments on AWS with Docker and GitHub Actions.',
      ],
      keywords: ['Node.js', 'PostgreSQL', 'AWS', 'Docker'],
    },
    {
      company: 'Accra Payments',
      title: 'Backend Engineer',
      startDate: '2019-01',
      endDate: '2022-02',
      location: 'Accra, Ghana',
      bullets: ['Built settlement reconciliation services handling 40k transactions per day.'],
      keywords: ['TypeScript', 'REST'],
    },
  ],
  education: [
    {
      institution: 'Kwame Nkrumah University of Science and Technology',
      degree: 'BSc',
      field: 'Computer Science',
      endDate: '2018-06',
    },
  ],
  projects: [],
  certifications: [],
  languages: ['English', 'Twi'],
};

const FACTS: Array<Omit<ProfileFact, 'id' | 'createdAt' | 'updatedAt'>> = [
  {
    kind: 'experience',
    label: 'Senior Backend Engineer at Kumasi Freight',
    detail:
      'Rebuilt the dispatch API in Node.js and PostgreSQL, cutting p95 latency from 1.4s to 180ms.',
    keywords: ['node.js', 'postgresql', 'api'],
    startDate: '2022-03',
    organisation: 'Kumasi Freight',
    role: 'Senior Backend Engineer',
    source: 'resume_parse',
    verified: true,
  },
  {
    kind: 'experience',
    label: 'Backend Engineer at Accra Payments',
    detail: 'Built settlement reconciliation services handling 40k transactions per day.',
    keywords: ['typescript', 'rest'],
    startDate: '2019-01',
    endDate: '2022-02',
    organisation: 'Accra Payments',
    role: 'Backend Engineer',
    source: 'resume_parse',
    verified: true,
  },
  {
    kind: 'skill',
    label: 'TypeScript',
    detail: 'Six years of production TypeScript.',
    keywords: ['typescript'],
    source: 'resume_parse',
    verified: true,
  },
  {
    kind: 'skill',
    label: 'PostgreSQL',
    detail: 'Schema design, query tuning and migrations.',
    keywords: ['postgresql', 'sql'],
    source: 'resume_parse',
    verified: true,
  },
  {
    kind: 'skill',
    label: 'AWS',
    detail: 'ECS, RDS and S3 in production.',
    keywords: ['aws', 'cloud'],
    source: 'resume_parse',
    verified: true,
  },
  {
    kind: 'skill',
    label: 'Docker',
    keywords: ['docker', 'containers'],
    source: 'resume_parse',
    verified: true,
  },
  {
    kind: 'skill',
    label: 'Kubernetes',
    // Left unverified on purpose: the demo shows what "not yet confirmed" means.
    keywords: ['kubernetes', 'k8s'],
    source: 'resume_parse',
    verified: false,
  },
  {
    kind: 'education',
    label: 'BSc Computer Science, KNUST',
    detail: 'Kwame Nkrumah University of Science and Technology, 2018.',
    keywords: ['computer science', 'bsc'],
    endDate: '2018-06',
    organisation: 'KNUST',
    source: 'resume_parse',
    verified: true,
  },
];

const PREFERENCES: JobPreferences = {
  ...DEFAULT_JOB_PREFERENCES,
  targetTitles: ['Senior Backend Engineer', 'Backend Engineer', 'Platform Engineer'],
  targetKeywords: ['typescript', 'node', 'postgresql', 'aws'],
  excludedKeywords: ['unpaid', 'commission only'],
  excludedCompanies: [],
  locations: ['Accra', 'Kumasi', 'Remote'],
  countryCodes: ['GH', 'NG', 'KE', 'ZA'],
  remoteOnly: false,
  workplaceTypes: ['remote', 'hybrid', 'onsite'],
  employmentTypes: ['full_time', 'contract'],
  seniorityLevels: ['mid', 'senior', 'lead'],
  minSalary: 60_000,
  salaryCurrency: 'USD',
  enabledSources: ['remotive', 'remoteok', 'jobicy', 'arbeitnow'],
  timeZone: 'Africa/Accra',
  scanHourLocal: 8,
};

// ------------------------------------------------------------------- listings

interface SeedListing {
  title: string;
  company: string;
  source: NormalizedJob['source'];
  externalId: string;
  description: string;
  locationRaw: string;
  countryCode?: string;
  remote: boolean;
  workplace: NormalizedJob['location']['workplace'];
  employmentType: NormalizedJob['employmentType'];
  seniority: NormalizedJob['seniority'];
  salary?: { min: number; max: number; currency: string; period: 'year' };
  tags: string[];
  postedDaysAgo: number;
}

const LISTINGS: SeedListing[] = [
  {
    title: 'Senior Backend Engineer (Payments)',
    company: 'Northwind Pay',
    source: 'remotive',
    externalId: 'seed-nw-1',
    description:
      'We are looking for a senior backend engineer to own our payments ledger. You will work in TypeScript and Node.js against PostgreSQL, deploy on AWS with Docker, and design REST APIs used by mobile clients. Experience with financial reconciliation and high-volume transaction processing is a strong plus. Kubernetes experience is a bonus.',
    locationRaw: 'Remote (Worldwide)',
    remote: true,
    workplace: 'remote',
    employmentType: 'full_time',
    seniority: 'senior',
    salary: { min: 95_000, max: 130_000, currency: 'USD', period: 'year' },
    tags: ['typescript', 'node.js', 'postgresql', 'aws', 'payments'],
    postedDaysAgo: 1,
  },
  {
    title: 'Backend Engineer, Logistics',
    company: 'Kigali Freight',
    source: 'jobicy',
    externalId: 'seed-kf-2',
    description:
      'Build dispatch and routing services for freight operators across East Africa. Our stack is Node.js, PostgreSQL and AWS. You will improve API performance and reliability, and work closely with the operations team. Docker and CI experience required.',
    locationRaw: 'Kigali, Rwanda',
    countryCode: 'RW',
    remote: false,
    workplace: 'onsite',
    employmentType: 'full_time',
    seniority: 'mid',
    salary: { min: 45_000, max: 60_000, currency: 'USD', period: 'year' },
    tags: ['node.js', 'postgresql', 'aws', 'logistics'],
    postedDaysAgo: 2,
  },
  {
    title: 'Platform Engineer (Kubernetes)',
    company: 'Helm Systems',
    source: 'remoteok',
    externalId: 'seed-hs-3',
    description:
      'Own our internal developer platform. You will run Kubernetes in production, build Terraform modules, and support service teams with golden paths. Strong Go or TypeScript, deep Linux knowledge, and on-call experience required.',
    locationRaw: 'Remote (EU)',
    remote: true,
    workplace: 'remote',
    employmentType: 'full_time',
    seniority: 'senior',
    salary: { min: 110_000, max: 145_000, currency: 'EUR', period: 'year' },
    tags: ['kubernetes', 'terraform', 'go', 'platform'],
    postedDaysAgo: 3,
  },
  {
    title: 'Full Stack Engineer',
    company: 'Wavelength Studio',
    source: 'arbeitnow',
    externalId: 'seed-ws-4',
    description:
      'A small product studio building tools for creatives. You will ship React front ends and Node.js APIs, and care deeply about accessible interfaces and fast pages. PostgreSQL and TypeScript experience needed.',
    locationRaw: 'Berlin, Germany',
    countryCode: 'DE',
    remote: false,
    workplace: 'hybrid',
    employmentType: 'full_time',
    seniority: 'mid',
    salary: { min: 65_000, max: 80_000, currency: 'EUR', period: 'year' },
    tags: ['react', 'node.js', 'typescript', 'postgresql'],
    postedDaysAgo: 4,
  },
  {
    title: 'Data Engineer',
    company: 'Sahel Analytics',
    source: 'remotive',
    externalId: 'seed-sa-5',
    description:
      'Design and operate batch and streaming pipelines in Python and dbt on AWS. You will model warehouse schemas and partner with analysts. Some PostgreSQL and Docker work is expected.',
    locationRaw: 'Remote (Africa)',
    remote: true,
    workplace: 'remote',
    employmentType: 'contract',
    seniority: 'mid',
    salary: { min: 55_000, max: 75_000, currency: 'USD', period: 'year' },
    tags: ['python', 'dbt', 'aws', 'data'],
    postedDaysAgo: 5,
  },
  {
    title: 'Mobile Engineer (React Native)',
    company: 'Trotro Technologies',
    source: 'jobicy',
    externalId: 'seed-tt-6',
    description:
      'Build a commuter app used across Ghana. You will own the React Native client, integrate REST APIs, and care about offline-first behaviour on low-end devices.',
    locationRaw: 'Accra, Ghana',
    countryCode: 'GH',
    remote: false,
    workplace: 'hybrid',
    employmentType: 'full_time',
    seniority: 'mid',
    salary: { min: 35_000, max: 50_000, currency: 'USD', period: 'year' },
    tags: ['react native', 'mobile', 'typescript'],
    postedDaysAgo: 6,
  },
  {
    title: 'Engineering Manager, Backend',
    company: 'Lagos Ledger',
    source: 'remoteok',
    externalId: 'seed-ll-7',
    description:
      'Lead a team of eight engineers building banking infrastructure. You will set technical direction, run hiring, and stay close to architecture. People management experience required; hands-on TypeScript and PostgreSQL work is a bonus.',
    locationRaw: 'Lagos, Nigeria',
    countryCode: 'NG',
    remote: false,
    workplace: 'hybrid',
    employmentType: 'full_time',
    seniority: 'lead',
    salary: { min: 90_000, max: 120_000, currency: 'USD', period: 'year' },
    tags: ['management', 'backend', 'typescript'],
    postedDaysAgo: 8,
  },
  {
    title: 'Junior Software Engineer',
    company: 'Kumasi Devs',
    source: 'arbeitnow',
    externalId: 'seed-kd-8',
    description:
      'Our first graduate hire. You will learn Node.js and PostgreSQL while pairing with senior engineers on internal tools. We teach Docker and testing in the first three months.',
    locationRaw: 'Kumasi, Ghana',
    countryCode: 'GH',
    remote: false,
    workplace: 'onsite',
    employmentType: 'full_time',
    seniority: 'junior',
    salary: { min: 12_000, max: 18_000, currency: 'USD', period: 'year' },
    tags: ['node.js', 'junior', 'graduate'],
    postedDaysAgo: 9,
  },
  {
    title: 'Backend Engineer (Go)',
    company: 'Sahara Streaming',
    source: 'remotive',
    externalId: 'seed-ss-9',
    description:
      'Work on a high-throughput media delivery service written in Go. You will own gRPC services, caching layers and PostgreSQL storage. AWS and Kubernetes experience expected.',
    locationRaw: 'Remote (Worldwide)',
    remote: true,
    workplace: 'remote',
    employmentType: 'full_time',
    seniority: 'senior',
    salary: { min: 85_000, max: 115_000, currency: 'USD', period: 'year' },
    tags: ['go', 'microservices', 'aws', 'kubernetes'],
    postedDaysAgo: 11,
  },
  {
    title: 'Technical Support Engineer',
    company: 'Accra Cloud',
    source: 'jobicy',
    externalId: 'seed-ac-10',
    description:
      'Support customers running our APIs in production. You will diagnose issues with curl and logs, write runbooks, and feed problems back to engineering. Some on-call rotation.',
    locationRaw: 'Accra, Ghana',
    countryCode: 'GH',
    remote: true,
    workplace: 'remote',
    employmentType: 'full_time',
    seniority: 'mid',
    salary: { min: 28_000, max: 40_000, currency: 'USD', period: 'year' },
    tags: ['support', 'apis', 'customer'],
    postedDaysAgo: 14,
  },
];

/**
 * Prisma rows use `null`; the shared types use optional properties. Normalise in
 * one place so the scoring engine always receives the domain shape.
 */
function toFactDtos(
  rows: Array<{
    id: string;
    kind: string;
    label: string;
    detail: string | null;
    keywords: string[];
    startDate: string | null;
    endDate: string | null;
    organisation: string | null;
    role: string | null;
    source: string;
    verified: boolean;
    evidenceRef: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>,
): ProfileFact[] {
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as ProfileFact['kind'],
    label: row.label,
    keywords: row.keywords,
    source: row.source as ProfileFact['source'],
    verified: row.verified,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.detail ? { detail: row.detail } : {}),
    ...(row.startDate ? { startDate: row.startDate } : {}),
    ...(row.endDate ? { endDate: row.endDate } : {}),
    ...(row.organisation ? { organisation: row.organisation } : {}),
    ...(row.role ? { role: row.role } : {}),
    ...(row.evidenceRef ? { evidenceRef: row.evidenceRef } : {}),
  }));
}

function toNormalizedJob(listing: SeedListing): NormalizedJob {
  const postedAt = daysAgo(listing.postedDaysAgo).toISOString();
  return {
    id: `seed-${listing.externalId}`,
    title: listing.title,
    company: listing.company,
    description: listing.description,
    url: `https://example.com/jobs/${listing.externalId}`,
    source: listing.source,
    externalId: listing.externalId,
    location: {
      raw: listing.locationRaw,
      remote: listing.remote,
      workplace: listing.workplace,
      ...(listing.countryCode ? { countryCode: listing.countryCode } : {}),
    },
    employmentType: listing.employmentType,
    seniority: listing.seniority,
    ...(listing.salary ? { salary: listing.salary } : {}),
    postedAt,
    tags: listing.tags,
    status: 'active',
    freshness: listing.postedDaysAgo <= 2 ? 'new' : listing.postedDaysAgo <= 7 ? 'fresh' : 'aging',
    firstSeenAt: postedAt,
    lastSeenAt: new Date(now).toISOString(),
    lastCheckedAt: new Date(now).toISOString(),
  };
}

// ---------------------------------------------------------------------- main

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');

  if (reset) {
    const existing = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
    if (existing) {
      logger.info('[seed] removing the previous demo account');
      await db.user.delete({ where: { id: existing.id } });
    }
  }

  const auth = new AuthService({ db, logger, sessionTtlHours: 24 });
  const existing = await db.user.findUnique({ where: { email: DEMO_EMAIL } });

  const user =
    existing ??
    (
      await auth.signUp({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        displayName: 'Ama Mensah',
        acceptedTerms: true,
        timeZone: PREFERENCES.timeZone,
      })
    ).user;

  logger.info(`[seed] demo account ready: ${DEMO_EMAIL}`);

  const userId = user.id as string;

  // Profile + preferences are upserted so re-running the seed is safe.
  await db.candidateProfile.upsert({
    where: { userId },
    create: {
      userId,
      content: PROFILE as never,
      headline: PROFILE.headline,
      summary: PROFILE.summary,
    },
    update: {
      content: PROFILE as never,
      headline: PROFILE.headline,
      summary: PROFILE.summary,
    },
  });

  await db.jobPreferences.upsert({
    where: { userId },
    create: {
      userId,
      targetTitles: PREFERENCES.targetTitles,
      targetKeywords: PREFERENCES.targetKeywords,
      excludedKeywords: PREFERENCES.excludedKeywords,
      excludedCompanies: PREFERENCES.excludedCompanies,
      locations: PREFERENCES.locations,
      countryCodes: PREFERENCES.countryCodes,
      remoteOnly: PREFERENCES.remoteOnly,
      workplaceTypes: PREFERENCES.workplaceTypes,
      employmentTypes: PREFERENCES.employmentTypes,
      seniorityLevels: PREFERENCES.seniorityLevels,
      minSalary: PREFERENCES.minSalary ?? null,
      salaryCurrency: PREFERENCES.salaryCurrency ?? null,
      enabledSources: PREFERENCES.enabledSources,
      timeZone: PREFERENCES.timeZone,
      scanHourLocal: PREFERENCES.scanHourLocal,
    },
    update: {
      targetTitles: PREFERENCES.targetTitles,
      targetKeywords: PREFERENCES.targetKeywords,
      excludedKeywords: PREFERENCES.excludedKeywords,
      locations: PREFERENCES.locations,
      countryCodes: PREFERENCES.countryCodes,
      remoteOnly: PREFERENCES.remoteOnly,
      workplaceTypes: PREFERENCES.workplaceTypes,
      employmentTypes: PREFERENCES.employmentTypes,
      seniorityLevels: PREFERENCES.seniorityLevels,
      minSalary: PREFERENCES.minSalary ?? null,
      salaryCurrency: PREFERENCES.salaryCurrency ?? null,
      enabledSources: PREFERENCES.enabledSources,
      timeZone: PREFERENCES.timeZone,
      scanHourLocal: PREFERENCES.scanHourLocal,
    },
  });

  await db.scanSchedule.upsert({
    where: { userId },
    create: {
      userId,
      enabled: true,
      timeZone: PREFERENCES.timeZone,
      hourLocal: PREFERENCES.scanHourLocal,
      lastRunAt: daysAgo(1),
      nextRunAt: new Date(now + 3_600_000),
    },
    update: { enabled: true, timeZone: PREFERENCES.timeZone, hourLocal: PREFERENCES.scanHourLocal },
  });

  // Facts: replace wholesale so the demo never accumulates duplicates.
  await db.profileFact.deleteMany({ where: { userId } });
  for (const fact of FACTS) {
    await db.profileFact.create({
      data: {
        userId,
        kind: fact.kind,
        label: fact.label,
        detail: fact.detail ?? null,
        keywords: fact.keywords,
        ...(fact.startDate ? { startDate: fact.startDate } : {}),
        ...(fact.endDate ? { endDate: fact.endDate } : {}),
        ...(fact.organisation ? { organisation: fact.organisation } : {}),
        ...(fact.role ? { role: fact.role } : {}),
        source: fact.source,
        verified: fact.verified,
        verifiedAt: fact.verified ? daysAgo(2) : null,
      },
    });
  }

  const verifiedFacts = await db.profileFact.findMany({ where: { userId, verified: true } });
  const profileVersion = buildProfileVersion(toFactDtos(verifiedFacts), PROFILE);

  // The source registry is a foreign key for source runs and attribution records.
  for (const entry of SOURCE_REGISTER) {
    await db.jobSource.upsert({
      where: { id: entry.id },
      create: {
        id: entry.id,
        name: entry.name,
        family: entry.family,
        accessMethod: entry.accessMethod,
        complianceNote: entry.complianceNote,
        enabled: entry.accessMethod === 'public_api',
        reviewedAt: new Date(),
      },
      update: { name: entry.name, complianceNote: entry.complianceNote },
    });
  }

  // Listings + real scores.
  let created = 0;
  for (const listing of LISTINGS) {
    const job = toNormalizedJob(listing);
    const dedupeKey = `${job.source}:${job.externalId}`;

    const row = await db.job.upsert({
      where: { dedupeKey },
      create: {
        dedupeKey,
        title: job.title,
        company: job.company,
        description: job.description,
        url: job.url,
        source: job.source,
        externalId: job.externalId,
        locationRaw: job.location.raw ?? null,
        countryCode: job.location.countryCode ?? null,
        remote: job.location.remote,
        workplace: job.location.workplace,
        employmentType: job.employmentType,
        seniority: job.seniority,
        salaryMin: job.salary?.min ?? null,
        salaryMax: job.salary?.max ?? null,
        salaryCurrency: job.salary?.currency ?? null,
        salaryPeriod: job.salary?.period ?? null,
        tags: job.tags,
        status: 'active',
        freshness: job.freshness,
        postedAt: job.postedAt ? new Date(job.postedAt) : null,
        firstSeenAt: new Date(job.firstSeenAt),
      },
      update: { lastCheckedAt: new Date() },
    });
    created += 1;

    await db.jobSourceRecord.upsert({
      where: { sourceKey: `${job.source}:${job.externalId}` },
      create: {
        jobId: row.id,
        sourceId: job.source,
        externalId: job.externalId,
        url: job.url,
        sourceKey: `${job.source}:${job.externalId}`,
      },
      update: { jobId: row.id, url: job.url },
    });

    // Score with the real engine — the dashboard must show real numbers.
    const score = scoreJob({
      job: { ...job, id: row.id },
      profile: PROFILE,
      verifiedFacts: toFactDtos(verifiedFacts),
      preferences: PREFERENCES,
    });

    await db.jobMatch.upsert({
      where: { userId_jobId: { userId, jobId: row.id } },
      create: {
        userId,
        jobId: row.id,
        score: score.score,
        band: score.band,
        excluded: score.excluded,
        exclusionReason: score.exclusionReason ?? null,
        scoringVersion: score.scoringVersion,
        profileVersion,
        components: score.components as never,
        evidence: score.evidence as never,
        gaps: score.gaps as never,
        usedSemantic: false,
        computedAt: new Date(),
      },
      update: {
        score: score.score,
        band: score.band,
        components: score.components as never,
        evidence: score.evidence as never,
        gaps: score.gaps as never,
        computedAt: new Date(),
      },
    });
  }

  // A completed scan run, so the dashboard's scan card is populated.
  const scanRun = await db.scanRun.create({
    data: {
      userId,
      trigger: 'scheduled',
      status: 'partial',
      startedAt: daysAgo(1),
      finishedAt: daysAgo(1),
      jobsFound: LISTINGS.length,
      jobsNew: 7,
      jobsUpdated: 3,
      errorSummary: 'remoteok responded slowly; retried once and succeeded.',
      sourceRuns: {
        create: PREFERENCES.enabledSources.map((sourceId, index) => ({
          sourceId,
          status: index === 3 ? 'partial' : 'succeeded',
          fetched: index === 3 ? 1 : 3,
          durationMs: 400 + index * 120,
          error: index === 3 ? 'Slow response' : null,
          note: null,
        })),
      },
    },
  });

  // Saved/dismissed state and one application with history.
  const jobs = await db.job.findMany({
    where: { dedupeKey: { in: LISTINGS.map((item) => `${item.source}:${item.externalId}`) } },
  });
  const byExternal = new Map(jobs.map((job) => [job.externalId, job]));

  const savedJob = byExternal.get('seed-nw-1');
  const dismissedJob = byExternal.get('seed-kd-8');
  const appliedJob = byExternal.get('seed-kf-2');

  if (savedJob) {
    await db.userJobState.upsert({
      where: { userId_jobId: { userId, jobId: savedJob.id } },
      create: { userId, jobId: savedJob.id, saved: true, viewedAt: daysAgo(0) },
      update: { saved: true },
    });
  }
  if (dismissedJob) {
    await db.userJobState.upsert({
      where: { userId_jobId: { userId, jobId: dismissedJob.id } },
      create: { userId, jobId: dismissedJob.id, dismissed: true, viewedAt: daysAgo(3) },
      update: { dismissed: true },
    });
  }

  if (appliedJob) {
    const application = await db.application.upsert({
      where: { userId_jobId: { userId, jobId: appliedJob.id } },
      create: {
        userId,
        jobId: appliedJob.id,
        status: 'applied',
        notes:
          'Referred by a former colleague. Recruiter said they review applications on Fridays.',
        appliedAt: daysAgo(2),
        nextActionAt: new Date(now + 2 * 86_400_000),
        events: {
          create: [
            { type: 'created', message: 'Application started', createdAt: daysAgo(3) },
            {
              type: 'status_change',
              fromStatus: 'ready_for_user',
              toStatus: 'applied',
              message: 'You marked this as applied',
              createdAt: daysAgo(2),
            },
          ],
        },
      },
      update: { status: 'applied', appliedAt: daysAgo(2) },
    });
    logger.info(`[seed] application ${application.id} seeded for ${appliedJob.title}`);
  }

  // Notifications are keyed by dedupeKey so re-seeding never piles them up.
  for (const notification of [
    {
      dedupeKey: 'seed:scan_completed',
      kind: 'scan_completed',
      title: `${LISTINGS.length} listings checked, 7 new`,
      body: 'Your morning scan finished. One source was slow and retried once.',
      link: '/jobs',
      createdAt: daysAgo(1),
    },
    {
      dedupeKey: 'seed:application_followup',
      kind: 'application_followup',
      title: 'Follow up with Kigali Freight',
      body: 'Two days have passed since you applied. A short note to the recruiter is often worth it.',
      link: '/applications',
      createdAt: daysAgo(0),
    },
  ]) {
    await db.notification.upsert({
      where: { userId_dedupeKey: { userId, dedupeKey: notification.dedupeKey } },
      create: { userId, ...notification },
      update: { title: notification.title, body: notification.body },
    });
  }

  logger.info(
    `[seed] scan run ${scanRun.id} with ${PREFERENCES.enabledSources.length} source runs`,
  );
  logger.info(`[seed] done: ${created} listings, ${FACTS.length} facts (1 unverified on purpose)`);
  logger.info(`[seed] sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .then(async () => {
    await db.$disconnect();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    logger.error('[seed] failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    await db.$disconnect().catch(() => undefined);
    process.exit(1);
  });
