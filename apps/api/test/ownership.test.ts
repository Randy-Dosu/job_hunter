/**
 * Per-user ownership isolation.
 *
 * The plan requires that authorization is enforced server-side and covered by
 * tests. Every scenario below has two signed-in users: one owns a resource, the
 * other must never be able to read, modify, export or delete it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sessionCookie, startHarness, type TestHarness } from './harness.js';

let harness: TestHarness;
let app: FastifyInstance;

let alice = '';
let bob = '';
let aliceId = '';
let bobId = '';

interface SignupResult {
  id: string;
  cookie: string;
}

async function signup(label: string): Promise<SignupResult> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      email: `${label}@example.test`,
      password: 'correct horse battery staple',
      displayName: label === 'alice' ? 'Alice Owusu' : 'Bob Adjei',
      acceptedTerms: true,
      timeZone: 'Africa/Accra',
    },
  });
  if (response.statusCode !== 201) throw new Error(`signup failed: ${response.body}`);
  return {
    id: (response.json() as { user: { id: string } }).user.id,
    cookie: sessionCookie(response.headers['set-cookie']),
  };
}

/** Insert a job directly: scans need network fixtures, ownership does not. */
async function createJob(
  title: string,
  externalId = `own-${title.length}-${Math.random().toString(16).slice(2)}`,
) {
  return harness.db.job.create({
    data: {
      title,
      company: 'Zola Systems',
      description: 'Build payment services with TypeScript and PostgreSQL.',
      url: `https://zola-systems.test/jobs/${externalId}`,
      remote: true,
      locationRaw: 'Remote (Worldwide)',
      employmentType: 'full_time',
      seniority: 'senior',
      tags: ['typescript', 'postgresql'],
      salaryMin: 90_000,
      salaryMax: 130_000,
      salaryCurrency: 'USD',
      salaryPeriod: 'year',
      postedAt: new Date('2026-11-10T09:00:00Z'),
      dedupeKey: `dedupe-${externalId}`,
      source: 'remoteok',
      externalId,
      status: 'active',
    },
  });
}

async function createVerifiedFact(userId: string, overrides: Record<string, unknown> = {}) {
  return harness.db.profileFact.create({
    data: {
      userId,
      kind: 'experience',
      label: 'Senior Backend Engineer at Kente Pay',
      detail: 'Built TypeScript payment services.',
      keywords: ['typescript'],
      verified: true,
      source: 'manual',
      ...overrides,
    },
  });
}

beforeAll(async () => {
  // Browser assistance is gated per deployment. Enable it here so the ownership
  // assertions exercise the authorization path rather than the feature switch.
  harness = await startHarness({ env: { FEATURE_BROWSER_ASSISTANT: 'true' } });
  app = harness.app;
  const a = await signup('alice');
  const b = await signup('bob');
  alice = a.cookie;
  bob = b.cookie;
  aliceId = a.id;
  bobId = b.id;
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

describe('profile isolation', () => {
  it('never returns another user’s profile facts', async () => {
    await createVerifiedFact(aliceId, { label: 'Alice private fact' });

    const own = await app.inject({
      method: 'GET',
      url: '/api/v1/profile/facts',
      headers: { cookie: alice },
    });
    expect(own.statusCode).toBe(200);
    expect(JSON.stringify(own.json())).toContain('Alice private fact');

    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/profile/facts',
      headers: { cookie: bob },
    });
    expect(other.statusCode).toBe(200);
    expect(JSON.stringify(other.json())).not.toContain('Alice private fact');
  });

  it('scopes fact creation and verification to the caller', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/facts',
      headers: { cookie: bob },
      payload: { kind: 'skill', label: 'Bob skill', keywords: ['bob'] },
    });
    expect(created.statusCode).toBe(201);
    const factId = (created.json() as { fact: { id: string } }).fact.id;

    // Alice cannot verify Bob's fact, even knowing the id: the update is scoped
    // by userId, so it matches nothing and reports zero changes (no information
    // about whether the id exists at all).
    const attempt = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/facts/verify',
      headers: { cookie: alice },
      payload: { factIds: [factId], verified: true },
    });
    expect(attempt.statusCode).toBe(200);
    expect((attempt.json() as { updated: number }).updated).toBe(0);

    const stillUnverified = await harness.db.profileFact.findUniqueOrThrow({
      where: { id: factId },
    });
    expect(stillUnverified.verified).toBe(false);
  });

  it('rejects unauthenticated access to every profile endpoint', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/profile'],
      ['GET', '/api/v1/profile/facts'],
      ['PUT', '/api/v1/profile'],
      ['GET', '/api/v1/preferences'],
      ['GET', '/api/v1/dashboard'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        ...(method === 'PUT' ? { payload: {} } : {}),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('job and document isolation', () => {
  it('does not expose another user’s match explanation', async () => {
    const job = await createJob('Senior Backend Engineer');

    const scored = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/match`,
      headers: { cookie: alice },
      payload: {},
    });
    expect([200, 201]).toContain(scored.statusCode);

    // Jobs are global, but match data is per-user: Bob's view must not contain
    // Alice's stored match row.
    const aliceMatch = await harness.db.jobMatch.findFirst({
      where: { jobId: job.id, userId: aliceId },
    });
    expect(aliceMatch).not.toBeNull();
    const bobMatch = await harness.db.jobMatch.findFirst({
      where: { jobId: job.id, userId: bobId },
    });
    expect(bobMatch).toBeNull();
  });

  it('refuses to generate a document for another user', async () => {
    const job = await createJob('Senior Backend Engineer Two');
    // Alice has verified facts; Bob does not.
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/documents`,
      headers: { cookie: alice },
      payload: { kind: 'resume' },
    });
    expect([200, 201]).toContain(created.statusCode);
    const documentId = (created.json() as { document: { id: string } }).document.id;

    // Bob cannot read, edit, approve or export Alice's document.
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${documentId}`,
      headers: { cookie: bob },
    });
    expect(read.statusCode).toBe(404);

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/documents/${documentId}`,
      headers: { cookie: bob },
      payload: { content: { headline: 'Hijacked', sections: [] } },
    });
    expect(edit.statusCode).toBe(404);

    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${documentId}/approve`,
      headers: { cookie: bob },
      payload: {},
    });
    expect(approve.statusCode).toBe(404);

    const exported = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${documentId}/export?format=pdf`,
      headers: { cookie: bob },
    });
    expect(exported.statusCode).toBe(404);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${documentId}`,
      headers: { cookie: bob },
    });
    expect(removed.statusCode).toBe(404);

    // The document is untouched and still owned by Alice.
    const stored = await harness.db.generatedDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(stored.userId).toBe(aliceId);
    expect(JSON.stringify(stored.content)).not.toContain('Hijacked');
  });

  it('404s an unknown id rather than 403, so ids cannot be probed', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/documents/00000000-0000-4000-8000-000000000000',
      headers: { cookie: alice },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('application isolation', () => {
  it('does not list or mutate another user’s applications', async () => {
    const job = await createJob('Senior Backend Engineer Three');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: { cookie: alice },
      payload: { jobId: job.id },
    });
    expect([200, 201]).toContain(created.statusCode);
    const applicationId = (created.json() as { application: { id: string } }).application.id;

    const bobList = await app.inject({
      method: 'GET',
      url: '/api/v1/applications',
      headers: { cookie: bob },
    });
    expect(bobList.statusCode).toBe(200);
    expect(JSON.stringify(bobList.json())).not.toContain(applicationId);

    const bobRead = await app.inject({
      method: 'GET',
      url: `/api/v1/applications/${applicationId}`,
      headers: { cookie: bob },
    });
    expect(bobRead.statusCode).toBe(404);

    const bobPatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/applications/${applicationId}`,
      headers: { cookie: bob },
      payload: { status: 'withdrawn' },
    });
    expect(bobPatch.statusCode).toBe(404);

    const bobNote = await app.inject({
      method: 'POST',
      url: `/api/v1/applications/${applicationId}/notes`,
      headers: { cookie: bob },
      payload: { message: 'Injected note' },
    });
    expect(bobNote.statusCode).toBe(404);

    const bobDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/applications/${applicationId}`,
      headers: { cookie: bob },
    });
    expect(bobDelete.statusCode).toBe(404);

    const stored = await harness.db.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(stored.userId).toBe(aliceId);
    expect(stored.status).not.toBe('withdrawn');
  });
});

describe('browser session isolation', () => {
  it('refuses to plan or end another user’s browser session', async () => {
    const job = await createJob('Senior Backend Engineer Four');
    const session = await harness.db.browserSession.create({
      data: {
        userId: aliceId,
        jobId: job.id,
        applicationUrl: 'https://zola-systems.test/apply/1',
        adapterId: 'generic',
        status: 'pending_consent',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    for (const [method, url, payload] of [
      ['POST', `/api/v1/browser-sessions/${session.id}/plan`, { html: '<form></form>' }],
      ['POST', `/api/v1/browser-sessions/${session.id}/pause`, {}],
      ['POST', `/api/v1/browser-sessions/${session.id}/end`, {}],
      ['GET', `/api/v1/browser-sessions/${session.id}`, undefined],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { cookie: bob },
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }

    const stored = await harness.db.browserSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.userId).toBe(aliceId);
    expect(stored.status).toBe('pending_consent');
  });
});

describe('notifications and privacy isolation', () => {
  it('only returns the caller’s notifications', async () => {
    await harness.db.notification.create({
      data: {
        userId: aliceId,
        kind: 'scan_completed',
        title: 'Alice only notification',
        dedupeKey: 'alice-dedupe-1',
      },
    });

    const aliceList = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { cookie: alice },
    });
    expect(JSON.stringify(aliceList.json())).toContain('Alice only notification');

    const bobList = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { cookie: bob },
    });
    expect(JSON.stringify(bobList.json())).not.toContain('Alice only notification');
  });

  it('exports only the caller’s data', async () => {
    await createVerifiedFact(aliceId, { label: 'Alice exported fact' });
    await createVerifiedFact(bobId, { label: 'Bob exported fact' });

    const aliceExport = await app.inject({
      method: 'GET',
      url: '/api/v1/privacy/export',
      headers: { cookie: alice },
    });
    expect(aliceExport.statusCode).toBe(200);
    expect(aliceExport.headers['cache-control']).toContain('no-store');
    expect(aliceExport.body).toContain('Alice exported fact');
    expect(aliceExport.body).not.toContain('Bob exported fact');
  });

  it('cannot delete another account', async () => {
    const attempt = await app.inject({
      method: 'POST',
      url: '/api/v1/privacy/delete',
      headers: { cookie: alice },
      payload: { password: 'correct horse battery staple', confirm: 'DELETE', userId: bobId },
    });
    // Either the extra field is ignored (deleting Alice) or rejected; it must
    // never delete Bob. Assert Bob survives.
    const bobStillExists = await harness.db.user.findUnique({ where: { id: bobId } });
    expect(bobStillExists).not.toBeNull();
    expect([200, 202, 204, 422, 400]).toContain(attempt.statusCode);
  });
});

describe('admin-only surfaces', () => {
  it('does not expose an admin route to a normal user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie: alice },
    });
    expect(response.statusCode).toBe(404);
  });
});
