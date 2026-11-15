/**
 * The first vertical slice from the plan, end to end through real HTTP:
 *
 *   account → verify profile facts → import a permitted listing →
 *   explainable match → tailored draft → approval gate → application record
 *
 * Also asserts the two hard product rules:
 *   - there is no endpoint that submits an application, and
 *   - no automated access path exists for sources that forbid it.
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
      email: 'slice@example.test',
      password: 'correct horse battery staple',
      displayName: 'Ama Mensah',
      acceptedTerms: true,
      timeZone: 'Africa/Accra',
    },
  });
  expect(created.statusCode).toBe(201);
  cookie = sessionCookie(created.headers['set-cookie']);
  userId = (created.json() as { user: { id: string } }).user.id;
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

const auth = () => ({ cookie });

/** Seed a listing as a permitted connector would have ingested it. */
async function seedJob(overrides: Record<string, unknown> = {}) {
  const externalId = `slice-${Math.random().toString(16).slice(2, 10)}`;
  return harness.db.job.create({
    data: {
      title: 'Senior Backend Engineer',
      company: 'Zola Systems',
      description: [
        'We are hiring a Senior Backend Engineer for our payments platform.',
        'Requirements: 5+ years with TypeScript, Node.js and PostgreSQL.',
        'You will use AWS and Docker. Remote-first, worldwide.',
      ].join(' '),
      url: `https://remoteok.test/jobs/${externalId}`,
      remote: true,
      locationRaw: 'Remote (Worldwide)',
      employmentType: 'full_time',
      seniority: 'senior',
      tags: ['typescript', 'nodejs', 'postgresql'],
      salaryMin: 95_000,
      salaryMax: 135_000,
      salaryCurrency: 'USD',
      salaryPeriod: 'year',
      postedAt: new Date('2026-11-11T09:00:00Z'),
      source: 'remoteok',
      externalId,
      dedupeKey: `dedupe-${externalId}`,
      status: 'active',
      ...overrides,
    },
  });
}

describe('step 1 — profile facts need explicit verification', () => {
  it('starts with an empty verified profile and refuses to invent one', async () => {
    const facts = await app.inject({
      method: 'GET',
      url: '/api/v1/profile/facts',
      headers: auth(),
    });
    expect(facts.statusCode).toBe(200);
    expect((facts.json() as { facts: unknown[] }).facts).toHaveLength(0);
  });

  it('creates facts as unverified, then verifies them on request', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/facts',
      headers: auth(),
      payload: {
        kind: 'experience',
        label: 'Senior Backend Engineer at Kente Pay',
        detail: 'Built TypeScript payment services and led a PostgreSQL migration.',
        organisation: 'Kente Pay',
        role: 'Senior Backend Engineer',
        startDate: '2020-03',
        keywords: ['typescript', 'postgresql'],
      },
    });
    expect(created.statusCode).toBe(201);
    const fact = (created.json() as { fact: { id: string; verified: boolean } }).fact;
    expect(fact.verified).toBe(false);

    for (const skill of ['TypeScript', 'Node.js', 'PostgreSQL', 'AWS', 'Docker']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/profile/facts',
        headers: auth(),
        payload: { kind: 'skill', label: skill, keywords: [skill.toLowerCase()] },
      });
      expect(response.statusCode).toBe(201);
    }

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/profile/facts',
      headers: auth(),
    });
    const ids = (listed.json() as { facts: Array<{ id: string }> }).facts.map((item) => item.id);
    expect(ids.length).toBe(6);

    const verified = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/facts/verify',
      headers: auth(),
      payload: { factIds: ids, verified: true },
    });
    expect(verified.statusCode).toBe(200);
    expect((verified.json() as { updated: number }).updated).toBe(6);
  });
});

describe('step 2 — a permitted listing produces an explainable match', () => {
  it('scores the listing and returns every dimension with evidence', async () => {
    const job = await seedJob();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/match`,
      headers: auth(),
      payload: {},
    });
    expect([200, 201]).toContain(response.statusCode);

    const body = response.json() as {
      match: {
        score: number;
        band: string;
        scoringVersion: string;
        profileVersion: string;
        usedSemantic: boolean;
        breakdown: Array<{
          label: string;
          scorePercent: number | null;
          weightPercent: number;
          points: number;
          rationale: string;
          status: string;
        }>;
        evidence: Array<{ factId: string; factLabel: string }>;
        gaps: Array<{ kind: string; requirement: string }>;
        unknowns: Array<{ kind: string; requirement: string }>;
        excluded: boolean;
      };
    };

    expect(body.match.score).toBeGreaterThanOrEqual(45);
    expect(['strong', 'good', 'fair']).toContain(body.match.band);
    expect(body.match.scoringVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(body.match.excluded).toBe(false);

    // Exactly the documented six dimensions, weights summing to 100%.
    expect(body.match.breakdown).toHaveLength(6);
    expect(body.match.breakdown.map((row) => row.label).sort()).toEqual(
      [
        'Skills & technologies',
        'Relevant experience',
        'Role alignment',
        'Education & certifications',
        'Location & work eligibility',
        'Preferences & job type',
      ].sort(),
    );
    const weightSum = body.match.breakdown.reduce((sum, row) => sum + row.weightPercent, 0);
    // Rounded per-row percentages may drift by a point or two.
    expect(Math.abs(weightSum - 100)).toBeLessThanOrEqual(3);

    // Explainability: the published points add up to the headline number.
    const points = body.match.breakdown.reduce((sum, row) => sum + row.points, 0);
    expect(Math.round(points)).toBe(body.match.score);

    // Every dimension explains itself in words.
    for (const row of body.match.breakdown) {
      expect(row.rationale.length).toBeGreaterThan(0);
      expect(['match', 'partial', 'gap', 'unknown']).toContain(row.status);
    }

    // Evidence must reference real verified facts.
    expect(body.match.evidence.length).toBeGreaterThan(0);
    const facts = (await app
      .inject({ method: 'GET', url: '/api/v1/profile/facts', headers: auth() })
      .then((r) => r.json())) as { facts: Array<{ id: string; verified: boolean }> };
    const verifiedIds = new Set(facts.facts.filter((fact) => fact.verified).map((fact) => fact.id));
    for (const item of body.match.evidence) expect(verifiedIds.has(item.factId)).toBe(true);
  });

  it('reports gaps honestly for a job that asks for more', async () => {
    const job = await seedJob({
      title: 'Principal Kubernetes Platform Engineer',
      description:
        'Requires 12+ years, deep Kubernetes, Terraform and Go expertise. PhD preferred.',
      tags: ['kubernetes', 'terraform', 'go'],
      seniority: 'principal',
      salaryMin: undefined,
      salaryMax: undefined,
      salaryCurrency: undefined,
      salaryPeriod: undefined,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/match`,
      headers: auth(),
      payload: {},
    });
    const body = response.json() as {
      match: { gaps: Array<{ kind: string; requirement: string }>; score: number };
    };
    expect(body.match.gaps.length).toBeGreaterThan(0);
    expect(body.match.gaps.some((gap) => /kubernetes/i.test(gap.requirement))).toBe(true);
  });

  it('filters listings by score and hides dismissed jobs', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?minScore=40',
      headers: auth(),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      items: Array<{ id: string; match?: { score: number } | null }>;
      total: number;
      page: number;
      pageSize: number;
    };
    expect(body.total).toBeGreaterThan(0);
    expect(body.page).toBe(1);
    // Only jobs at or above the requested score are returned.
    for (const job of body.items) expect(job.match?.score ?? 0).toBeGreaterThanOrEqual(40);

    const first = body.items[0];
    expect(first).toBeDefined();
    const dismissed = await app.inject({
      method: 'PUT',
      url: `/api/v1/jobs/${first!.id}/state`,
      headers: auth(),
      payload: { dismissed: true },
    });
    expect(dismissed.statusCode).toBe(200);

    // Relevance feedback is recorded separately and never deletes the job.
    const feedback = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${first!.id}/feedback`,
      headers: auth(),
      payload: { relevance: 'not_relevant', reason: 'Not a payments role' },
    });
    expect([200, 201]).toContain(feedback.statusCode);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?minScore=40',
      headers: auth(),
    });
    expect(JSON.stringify(after.json())).not.toContain(first!.id);
  });
});

describe('step 3 — the document approval gate', () => {
  it('generates a draft that cannot be exported until approved', async () => {
    const job = await seedJob({ title: 'Senior Backend Engineer (Payments)' });

    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/documents`,
      headers: auth(),
      payload: { kind: 'resume' },
    });
    expect([200, 201]).toContain(generated.statusCode);
    const document = (
      generated.json() as { document: { id: string; status: string; version: number } }
    ).document;
    expect(document.status).toBe('draft');
    expect(document.version).toBe(1);

    const blocked = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}/export?format=pdf`,
      headers: auth(),
    });
    expect(blocked.statusCode).toBe(409);

    // JSON is allowed before approval so the user can inspect the raw content.
    const inspect = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${document.id}/export?format=json`,
      headers: auth(),
    });
    expect(inspect.statusCode).toBe(200);
  });

  it('re-checks evidence against the current verified profile on approval', async () => {
    const job = await seedJob({ title: 'Backend Engineer (Platform)' });
    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/documents`,
      headers: auth(),
      payload: { kind: 'resume' },
    });
    const documentId = (generated.json() as { document: { id: string } }).document.id;

    // Introduce an unsupported claim by editing the content.
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${documentId}`,
      headers: auth(),
      payload: {
        content: {
          headline: 'Senior Backend Engineer',
          summary: 'Backend engineer.',
          sections: [
            {
              heading: 'Experience',
              bullets: ['Scaled revenue by 340% and managed a team of 25 engineers.'],
              evidenceIds: [],
            },
          ],
        },
      },
    });
    expect(edited.statusCode).toBe(200);
    const warnings = (edited.json() as { document: { warnings: string[] } }).document.warnings;
    expect(warnings.length).toBeGreaterThan(0);

    // Approval is blocked while unsupported claims remain...
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${documentId}/approve`,
      headers: auth(),
      payload: {},
    });
    expect(blocked.statusCode).toBe(409);

    // ...unless the user explicitly acknowledges them.
    const acknowledged = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${documentId}/approve`,
      headers: auth(),
      payload: { acknowledgeWarnings: true },
    });
    expect([200, 201]).toContain(acknowledged.statusCode);

    const exported = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${documentId}/export?format=pdf`,
      headers: auth(),
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toBe('application/pdf');
    expect(exported.headers['cache-control']).toContain('no-store');
    expect(exported.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('supersedes an older approved version of the same kind', async () => {
    const job = await seedJob({ title: 'Staff Backend Engineer' });
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/documents`,
      headers: auth(),
      payload: { kind: 'cover_letter' },
    });
    const firstId = (first.json() as { document: { id: string } }).document.id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${firstId}/approve`,
      headers: auth(),
      payload: { acknowledgeWarnings: true },
    });

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/documents`,
      headers: auth(),
      payload: { kind: 'cover_letter' },
    });
    const secondId = (second.json() as { document: { id: string } }).document.id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${secondId}/approve`,
      headers: auth(),
      payload: { acknowledgeWarnings: true },
    });

    const docs = await harness.db.generatedDocument.findMany({
      where: { userId, jobId: job.id, kind: 'cover_letter' },
      orderBy: { version: 'asc' },
    });
    expect(docs).toHaveLength(2);
    expect(docs.find((doc) => doc.id === secondId)?.status).toBe('approved');
    // Exactly one approved document per kind per job.
    expect(docs.filter((doc) => doc.status === 'approved')).toHaveLength(1);
  });
});

describe('step 4 — the application record', () => {
  let applicationId = '';

  it('attaches only approved documents', async () => {
    const job = await seedJob({ title: 'Backend Engineer (Application)' });
    const draft = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/documents`,
      headers: auth(),
      payload: { kind: 'resume' },
    });
    const draftId = (draft.json() as { document: { id: string } }).document.id;

    // Attaching a draft is refused.
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: auth(),
      payload: { jobId: job.id, resumeDocumentId: draftId },
    });
    expect(created.statusCode).toBe(409);

    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${draftId}/approve`,
      headers: auth(),
      payload: { acknowledgeWarnings: true },
    });
    const withApproved = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: auth(),
      payload: { jobId: job.id, resumeDocumentId: draftId },
    });
    expect([200, 201]).toContain(withApproved.statusCode);
    const application = (withApproved.json() as { application: { id: string; status: string } })
      .application;
    applicationId = application.id;
    expect(application.status).toBe('saved');
  });

  it('refuses to run the whole slice twice for the same job', async () => {
    const existing = await harness.db.application.findUniqueOrThrow({
      where: { id: applicationId },
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: auth(),
      payload: { jobId: existing.jobId },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('only allows documented status transitions and logs each change', async () => {
    const forward = await app.inject({
      method: 'PATCH',
      url: `/api/v1/applications/${applicationId}`,
      headers: auth(),
      payload: { status: 'preparing' },
    });
    expect(forward.statusCode).toBe(200);

    // saved → offer is not an allowed edge.
    const skip = await app.inject({
      method: 'PATCH',
      url: `/api/v1/applications/${applicationId}`,
      headers: auth(),
      payload: { status: 'offer' },
    });
    expect(skip.statusCode).toBe(409);

    const events = await harness.db.applicationEvent.findMany({ where: { applicationId } });
    expect(events.some((event) => event.type === 'status_change')).toBe(true);
  });

  it('marks the application as ready for the user, never as submitted by us', async () => {
    for (const status of ['ready_for_user'] as const) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/applications/${applicationId}`,
        headers: auth(),
        payload: { status },
      });
      expect(response.statusCode).toBe(200);
    }

    const record = await harness.db.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(record.status).toBe('ready_for_user');
    expect(record.appliedAt).toBeNull();
    // There is no `submittedBySystem` column anywhere in the schema: the system
    // has no way to record a submission at all, let alone perform one.
    expect(Object.keys(record)).not.toContain('submittedBySystem');
  });

  it('records "applied" only when the user says they applied', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/applications/${applicationId}`,
      headers: auth(),
      payload: { status: 'applied' },
    });
    expect(response.statusCode).toBe(200);
    const record = await harness.db.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(record.status).toBe('applied');
    // The timestamp is recorded from the user's own confirmation.
    expect(record.appliedAt).not.toBeNull();
  });

  it('archives rather than deletes', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/applications/${applicationId}`,
      headers: auth(),
    });
    expect([200, 204]).toContain(response.statusCode);

    const record = await harness.db.application.findUnique({ where: { id: applicationId } });
    expect(record).not.toBeNull();
    expect(record?.archivedAt).not.toBeNull();
  });
});

describe('hard rule — no submission capability exists', () => {
  it('has no endpoint that submits an application', async () => {
    // Enumerate via the framework's own router table.
    const printed = app.printRoutes({ commonPrefix: false });

    const forbidden = [
      /\/submit\b/i,
      /\/applications\/[^/]+\/submit/i,
      /\/browser-sessions\/[^/]+\/submit/i,
      /\/auto-?submit/i,
      /\/finalize/i,
    ];
    for (const pattern of forbidden) {
      expect(printed).not.toMatch(pattern);
    }
  });

  it('rejects any attempt to hit a submit-shaped URL', async () => {
    const job = await seedJob({ title: 'Submit Guard Test' });
    for (const url of [
      `/api/v1/jobs/${job.id}/submit`,
      `/api/v1/applications/${job.id}/submit`,
      `/api/v1/browser-sessions/${job.id}/submit`,
      '/api/v1/submit',
    ]) {
      const response = await app.inject({ method: 'POST', url, headers: auth(), payload: {} });
      expect(response.statusCode, url).toBe(404);
    }
  });

  it('keeps browser assistance off when no site is allowlisted', async () => {
    const capabilities = await app.inject({
      method: 'GET',
      url: '/api/v1/browser-sessions/capabilities',
      headers: auth(),
    });
    expect(capabilities.statusCode).toBe(200);
    const body = capabilities.json() as {
      enabled: boolean;
      allowlist: unknown[];
      guarantees: string[];
    };
    expect(body.allowlist).toEqual([]);
    expect(body.guarantees.join(' ')).toMatch(/no submit action/i);
    expect(body).not.toHaveProperty('canSubmit');
  });

  it('exposes manual search links instead of scraping restricted sites', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/sources', headers: auth() });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      sources: Array<{ id: string; accessMethod: string; automated: boolean }>;
      manualHandoff: Array<{ id: string }>;
    };

    const restricted = body.sources.filter((source) =>
      ['linkedin', 'indeed', 'google_jobs', 'wellfound'].includes(source.id),
    );
    expect(restricted.length).toBeGreaterThan(0);
    for (const source of restricted) {
      expect(source.accessMethod).toBe('manual_handoff');
      expect(source.automated).toBe(false);
    }

    // Pre-filled manual search URLs are available instead.
    const links = await app.inject({
      method: 'GET',
      url: '/api/v1/sources/manual-links',
      headers: auth(),
    });
    expect(links.statusCode).toBe(200);
    const linkBody = links.json() as { links: Array<{ id: string; url: string }> };
    for (const link of linkBody.links) expect(link.url).toMatch(/^https:\/\//);
  });
});
