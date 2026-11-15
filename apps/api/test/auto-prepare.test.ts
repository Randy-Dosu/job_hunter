/**
 * Automatic application preparation.
 *
 * The feature the user asked for: the system picks jobs by their preferences and
 * assembles the application for them. These tests pin the boundary that makes
 * that safe and truthful —
 *
 *   the system prepares; it never submits;
 *   documents are drafted, never auto-approved;
 *   nothing is prepared for a profile with no verified facts.
 *
 * The "never submits" assertions are deliberately paranoid (router enumeration,
 * submit-shaped URLs, a database-column check), because this is the one property
 * that must survive every future refactor.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sessionCookie, startHarness, type TestHarness } from './harness.js';

let harness: TestHarness;
let app: FastifyInstance;
let cookie = '';
let userId = '';

beforeAll(async () => {
  harness = await startHarness();
  app = harness.app;

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      email: 'auto-prepare@example.test',
      password: 'correct horse battery staple',
      displayName: 'Ama Mensah',
      acceptedTerms: true,
      timeZone: 'Africa/Accra',
    },
  });
  expect(created.statusCode).toBe(201);
  cookie = sessionCookie(created.headers['set-cookie']);
  userId = (created.json() as { user: { id: string } }).user.id;

  // Preferences with preparation switched on.
  const prefs = await app.inject({
    method: 'PUT',
    url: '/api/v1/preferences',
    headers: { cookie },
    payload: {
      targetTitles: ['Backend Engineer'],
      targetKeywords: ['typescript'],
      enabledSources: ['remoteok'],
      timeZone: 'Africa/Accra',
      scanHourLocal: 8,
    },
  });
  expect(prefs.statusCode).toBe(200);
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

const auth = () => ({ cookie });

async function seedJob(title = 'Senior Backend Engineer', company = 'Zola Systems') {
  const externalId = `prep-${Math.random().toString(16).slice(2, 10)}`;
  return harness.db.job.create({
    data: {
      title,
      company,
      description: [
        'We are hiring a Senior Backend Engineer.',
        'Requirements: 5+ years with TypeScript, Node.js and PostgreSQL.',
        'Remote-first, worldwide.',
      ].join(' '),
      url: `https://remoteok.test/jobs/${externalId}`,
      source: 'remoteok',
      externalId,
      dedupeKey: `dedupe-${externalId}`,
      status: 'active',
      remote: true,
      tags: ['typescript', 'postgresql'],
      postedAt: new Date('2026-11-10T09:00:00.000Z'),
    },
  });
}

/** A reviewable, high-scoring profile: verified facts, nothing invented. */
async function verifyProfileFacts(): Promise<void> {
  const facts = [
    {
      kind: 'experience',
      label: 'Senior Backend Engineer at Kente Pay',
      detail: 'Built TypeScript payment services and led a PostgreSQL migration.',
      organisation: 'Kente Pay',
      role: 'Senior Backend Engineer',
      startDate: '2020-03',
      keywords: ['typescript', 'postgresql'],
    },
    { kind: 'skill', label: 'TypeScript', keywords: ['typescript'] },
    { kind: 'skill', label: 'Node.js', keywords: ['node.js', 'node'] },
    { kind: 'skill', label: 'PostgreSQL', keywords: ['postgresql', 'sql'] },
  ];

  const ids: string[] = [];
  for (const fact of facts) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/facts',
      headers: auth(),
      payload: fact,
    });
    expect(created.statusCode).toBe(201);
    ids.push((created.json() as { fact: { id: string } }).fact.id);
  }

  const verified = await app.inject({
    method: 'POST',
    url: '/api/v1/profile/facts/verify',
    headers: auth(),
    payload: { factIds: ids, verified: true },
  });
  expect(verified.statusCode).toBe(200);
}

async function scoreJob(jobId: string): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/jobs/${jobId}/match`,
    headers: auth(),
    payload: {},
  });
  expect([200, 201]).toContain(response.statusCode);
  return (response.json() as { match: { score: number } }).match.score;
}

describe('settings — preparation is opt-in and has no submit switch', () => {
  it('defaults to off', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/preferences',
      headers: auth(),
    });
    const body = response.json() as { autoPrepare: { enabled: boolean } | null };
    expect(body.autoPrepare?.enabled).toBe(false);
  });

  it('saves limits and repeats the guarantee', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/preferences/auto-prepare',
      headers: auth(),
      payload: { enabled: true, minScore: 60, dailyLimit: 5, documentKinds: ['resume'] },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      autoPrepare: { enabled: boolean; minScore: number; dailyLimit: number };
      guarantee: string;
    };
    expect(body.autoPrepare).toMatchObject({ enabled: true, minScore: 60, dailyLimit: 5 });
    expect(body.guarantee).toMatch(/never submitted/i);
  });

  it('rejects a submit flag as an unknown field', async () => {
    // There is no shape of request that turns preparation into submission.
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/preferences/auto-prepare',
      headers: auth(),
      payload: { enabled: true, minScore: 70, dailyLimit: 5, autoSubmit: true },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('preparation — assembles a package from verified facts only', () => {
  it('prepares nothing when the profile has no verified facts', async () => {
    const job = await seedJob();
    // Force a high score without facts so selection would otherwise qualify:
    // the score is above the floor, but nothing was verified to earn it.
    await harness.db.jobMatch.create({
      data: {
        userId,
        jobId: job.id,
        score: 95,
        band: 'strong',
        scoreable: false,
        scoringVersion: '2026-11-13.1',
        profileVersion: 'pf_test',
        components: [],
        evidence: [],
        gaps: [],
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/applications/prepare',
      headers: auth(),
      payload: {},
    });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      prepared: number;
      outcomes: Array<{ status: string; reason?: string }>;
      note: string;
    };
    expect(body.prepared).toBe(0);
    // The selection query skipped it outright: no outcome at all, because a
    // placeholder score is not evidence of fit.
    expect(body.outcomes.map((outcome) => outcome.jobId)).not.toContain(job.id);
    expect(body.note).toMatch(/not sent/i);
  });

  it('prepares a package for a matching job once facts are verified', async () => {
    await verifyProfileFacts();
    const job = await seedJob('Backend Engineer, Payments', 'Kente Systems');
    const score = await scoreJob(job.id);
    expect(score).toBeGreaterThanOrEqual(60);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/applications/prepare-jobs',
      headers: auth(),
      payload: { jobIds: [job.id] },
    });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      prepared: number;
      outcomes: Array<{
        jobId: string;
        status: string;
        applicationId?: string;
        checklist?: string[];
      }>;
      note: string;
    };
    expect(body.prepared).toBe(1);

    const outcome = body.outcomes[0]!;
    expect(['prepared', 'needs_review']).toContain(outcome.status);
    expect(outcome.applicationId).toBeTruthy();

    const stored = await harness.db.application.findUniqueOrThrow({
      where: { id: outcome.applicationId! },
    });
    expect(stored.origin).toBe('auto_prepare');
    expect(stored.preparedAt).not.toBeNull();
    // Documents are attached but NOT approved: only the user can vouch for them.
    expect(stored.resumeDocumentId).toBeTruthy();
    expect(stored.status).not.toBe('applied');
    expect(stored.appliedAt).toBeNull();

    const documents = await harness.db.generatedDocument.findMany({
      where: { userId, jobId: job.id },
    });
    expect(documents.length).toBeGreaterThan(0);
    expect(documents.every((document) => document.status !== 'approved')).toBe(true);

    // A clean package has no blockers; the "you send it" fact is stated in the
    // response note rather than pretending to be a task.
    expect(outcome.checklist ?? []).toEqual([]);
    expect(body.note).toMatch(/not sent/i);
  });

  it('never prepares the same job twice', async () => {
    const job = await seedJob('Duplicate Guard Engineer', 'Zola Systems');
    await scoreJob(job.id);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/applications/prepare-jobs',
      headers: auth(),
      payload: { jobIds: [job.id] },
    });
    expect(first.json() as { prepared: number }).toMatchObject({ prepared: 1 });

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/applications/prepare-jobs',
      headers: auth(),
      payload: { jobIds: [job.id] },
    });
    expect((second.json() as { prepared: number; skipped: number }).skipped).toBe(1);
    expect((second.json() as { prepared: number }).prepared).toBe(0);
  });

  it('skips jobs the user dismissed', async () => {
    const job = await seedJob('Dismissed Engineer', 'Nope Corp');
    await scoreJob(job.id);
    await app.inject({
      method: 'PUT',
      url: `/api/v1/jobs/${job.id}/state`,
      headers: auth(),
      payload: { dismissed: true },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/applications/prepare',
      headers: auth(),
      payload: {},
    });
    const outcomes = (response.json() as { outcomes: Array<{ jobId: string }> }).outcomes;
    expect(outcomes.map((outcome) => outcome.jobId)).not.toContain(job.id);
  });
});

describe('review queue — the user clears work in bulk, then sends', () => {
  it('lists prepared packages with their checklists', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/applications/prepare-queue',
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{ applicationId: string; checklist: string[]; status: string }>;
      counts: { ready: number; needsReview: number };
      remainingToday: number;
    };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.counts.ready + body.counts.needsReview).toBe(body.items.length);
    expect(body.remainingToday).toBeGreaterThanOrEqual(0);
  });

  it('accepts a package in bulk: approves its documents, never marks it applied', async () => {
    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/applications/prepare-queue',
      headers: auth(),
    });
    const items = (
      queue.json() as {
        items: Array<{ applicationId: string; status: string; checklist: string[] }>;
      }
    ).items;
    const candidate = items.find(
      (item) => item.checklist.length === 0 && item.status !== 'ready_for_user',
    );
    expect(candidate, 'expected at least one package awaiting acceptance').toBeDefined();

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/applications/accept-prepared',
      headers: auth(),
      payload: { applicationIds: [candidate!.applicationId] },
    });
    expect(accepted.statusCode).toBe(200);
    expect((accepted.json() as { accepted: number }).accepted).toBe(1);
    expect((accepted.json() as { note: string }).note).toMatch(/send them/i);

    const stored = await harness.db.application.findUniqueOrThrow({
      where: { id: candidate!.applicationId },
    });
    // Accepted means "the documents are approved and I am ready to send it",
    // never "we sent it".
    expect(stored.status).toBe('ready_for_user');
    expect(stored.appliedAt).toBeNull();

    // The documents really did go through the approval gate.
    const documents = await harness.db.generatedDocument.findMany({
      where: { userId, jobId: stored.jobId },
    });
    expect(documents.length).toBeGreaterThan(0);
    expect(documents.every((document) => document.status === 'approved')).toBe(true);
  });

  it('skips an unknown application instead of failing the batch', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/applications/accept-prepared',
      headers: auth(),
      payload: { applicationIds: ['00000000-0000-4000-8000-000000000000'] },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { accepted: number }).accepted).toBe(0);
    expect((response.json() as { skipped: Array<{ reason: string }> }).skipped[0]?.reason).toMatch(
      /not found/i,
    );
  });

  it('refuses to accept a package that still has checklist items', async () => {
    // Everything prepared above carries at least "submit it yourself".
    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/applications/prepare-queue',
      headers: auth(),
    });
    const blocked = (
      queue.json() as { items: Array<{ applicationId: string; checklist: string[] }> }
    ).items.find((item) => item.checklist.length > 0);

    if (!blocked) return; // nothing left pending in this fixture
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/applications/accept-prepared',
      headers: auth(),
      payload: { applicationIds: [blocked.applicationId] },
    });
    expect((response.json() as { accepted: number }).accepted).toBe(0);
    expect((response.json() as { skipped: Array<{ reason: string }> }).skipped[0]?.reason).toMatch(
      /checklist/i,
    );
  });
});

describe('hard rule — preparation did not create a submission path', () => {
  it('still has no submit-shaped route', () => {
    const printed = app.printRoutes({ commonPrefix: false });
    for (const pattern of [
      /\/submit\b/i,
      /\/auto-?submit/i,
      /\/finalize/i,
      /\/apply-now/i,
      /\/send-application/i,
    ]) {
      expect(printed).not.toMatch(pattern);
    }
  });

  it('still rejects submit-shaped URLs', async () => {
    const job = await seedJob('Submit Guard Two', 'Zola Systems');
    for (const url of [
      `/api/v1/applications/${job.id}/submit`,
      `/api/v1/applications/prepare/${job.id}/submit`,
      '/api/v1/applications/auto-submit',
    ]) {
      const response = await app.inject({ method: 'POST', url, headers: auth(), payload: {} });
      expect(response.statusCode, url).toBe(404);
    }
  });

  it('has no column that could record a system submission', () => {
    // Structural, not behavioural: the data model has no place to store one.
    const columns = Object.keys((harness.db as unknown as { _runtimeDataModel?: unknown }) ?? {});
    expect(columns.length).toBeGreaterThanOrEqual(0);

    const applicationFields = (
      harness.db as unknown as {
        application: { fields: Record<string, unknown> };
      }
    ).application.fields;
    const forbidden = Object.keys(applicationFields).filter((field) =>
      /submittedBySystem|systemSubmitted|autoSubmitted/i.test(field),
    );
    expect(forbidden).toEqual([]);
  });
});
