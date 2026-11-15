/**
 * Regressions found by exercising the running API by hand (the sweep).
 *
 * Each block names the defect it pins down, because all five were silent: the
 * API answered 2xx or an unrelated 4xx and the UI quietly showed the wrong
 * thing. These tests go through real HTTP so routing, content-type handling,
 * CORS and Prisma are all in the path.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sessionCookie, startHarness, type TestHarness } from './harness.js';

let harness: TestHarness;
let app: FastifyInstance;
let cookie = '';

const PASSWORD = 'correct horse battery staple';

async function signUp(email: string): Promise<{ cookie: string; userId: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      email,
      password: PASSWORD,
      displayName: 'Sweep Tester',
      acceptedTerms: true,
      timeZone: 'Africa/Accra',
    },
  });
  expect(response.statusCode).toBe(201);
  return {
    cookie: sessionCookie(response.headers['set-cookie']),
    userId: (response.json() as { user: { id: string } }).user.id,
  };
}

beforeAll(async () => {
  harness = await startHarness();
  app = harness.app;
  cookie = (await signUp('regressions@example.test')).cookie;
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

const auth = () => ({ cookie });

async function seedJob(): Promise<{ id: string }> {
  const externalId = `reg-${Math.random().toString(16).slice(2, 10)}`;
  return harness.db.job.create({
    data: {
      title: 'Senior Backend Engineer',
      company: 'Zola Systems',
      description:
        'We are hiring a Senior Backend Engineer. Requirements: 5+ years with TypeScript, Node.js and PostgreSQL. Remote-first.',
      url: `https://remoteok.test/jobs/${externalId}`,
      source: 'remoteok',
      externalId,
      status: 'active',
      remote: true,
      tags: ['typescript', 'postgresql'],
      postedAt: new Date('2026-11-10T09:00:00.000Z'),
      dedupeKey: `dedupe-${externalId}`,
    },
  }) as Promise<{ id: string }>;
}

describe('bug — an empty JSON body was rejected before the handler ran', () => {
  it('accepts DELETE with content-type json and no body', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/facts',
      headers: auth(),
      payload: { kind: 'skill', label: 'TypeScript', keywords: ['typescript'] },
    });
    expect(created.statusCode).toBe(201);
    const factId = (created.json() as { fact: { id: string } }).fact.id;

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/profile/facts/${factId}`,
      headers: { ...auth(), 'content-type': 'application/json' },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('accepts "mark all read" with content-type json and no body', async () => {
    await harness.db.notification.create({
      data: {
        userId: (
          await app
            .inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth() })
            .then((r) => r.json() as { user: { id: string } })
        ).user.id,
        kind: 'system',
        title: 'Welcome',
        body: 'Hello',
        dedupeKey: `welcome-${Math.random().toString(16).slice(2, 10)}`,
      },
    });

    const readAll = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/read-all',
      headers: { ...auth(), 'content-type': 'application/json' },
    });
    expect([200, 204]).toContain(readAll.statusCode);
  });

  it('still rejects genuinely malformed JSON with a 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      headers: { 'content-type': 'application/json' },
      payload: '{"email": ',
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('bug — preview origins were trusted in production', () => {
  it('refuses a foreign preview origin when NODE_ENV is production', async () => {
    const production = await startHarness({ env: { NODE_ENV: 'production' } });
    try {
      const response = await production.app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://attacker.e2b.app' },
      });
      const allowOrigin = response.headers['access-control-allow-origin'];
      expect(allowOrigin).not.toBe('https://attacker.e2b.app');
    } finally {
      await production.close();
    }
  }, 120_000);

  it('still trusts the sandbox preview origin outside production', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'https://preview-1234.e2b.app' },
    });
    expect(response.headers['access-control-allow-origin']).toBe('https://preview-1234.e2b.app');
  });
});

describe('bug — a malformed id was reported as a missing resource', () => {
  it('returns 422 for a non-UUID path parameter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/not-a-uuid',
      headers: auth(),
    });
    expect(response.statusCode).toBe(422);
  });

  it('still returns 404 for a well-formed id that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/00000000-0000-4000-8000-000000000000',
      headers: auth(),
    });
    expect(response.statusCode).toBe(404);
  });

  it('validates ids on every resource, not just jobs', async () => {
    const cases: Array<{ method: 'GET' | 'POST' | 'DELETE'; url: string }> = [
      { method: 'GET', url: '/api/v1/documents/nope' },
      { method: 'GET', url: '/api/v1/applications/nope' },
      { method: 'DELETE', url: '/api/v1/resumes/nope' },
      { method: 'POST', url: '/api/v1/notifications/nope/read' },
      { method: 'DELETE', url: '/api/v1/profile/facts/nope' },
    ];
    for (const { method, url } of cases) {
      const response = await app.inject({ method, url, headers: auth() });
      expect(response.statusCode, url).toBe(422);
    }
  });
});

describe('bug — "saved only" resurrected dismissed jobs', () => {
  it('keeps a dismissed job out of the saved list', async () => {
    const job = await seedJob();

    const dismissed = await app.inject({
      method: 'PUT',
      url: `/api/v1/jobs/${job.id}/state`,
      headers: auth(),
      payload: { saved: true, dismissed: true },
    });
    expect(dismissed.statusCode).toBe(200);

    const saved = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?saved=true',
      headers: auth(),
    });
    expect(saved.statusCode).toBe(200);
    const ids = (saved.json() as { items: Array<{ id: string }> }).items.map((item) => item.id);
    expect(ids).not.toContain(job.id);

    // Asking for dismissed jobs explicitly still shows it.
    const dismissedList = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?dismissed=true',
      headers: auth(),
    });
    const dismissedIds = (dismissedList.json() as { items: Array<{ id: string }> }).items.map(
      (item) => item.id,
    );
    expect(dismissedIds).toContain(job.id);
  });
});

describe('bug — an empty profile was rated "fair"', () => {
  it('reports scoreable=false and shows no fit badge for a fresh account', async () => {
    const fresh = await signUp('empty-profile@example.test');
    const job = await seedJob();

    const recomputed = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/match`,
      headers: { cookie: fresh.cookie },
      payload: {},
    });
    expect([200, 201]).toContain(recomputed.statusCode);
    const match = (
      recomputed.json() as { match: { scoreable: boolean; score: number; band: string } }
    ).match;
    expect(match.scoreable).toBe(false);
    expect(match.score).toBeLessThan(45);
    expect(match.band).toBe('weak');

    // The list endpoint must carry the flag through, and it must survive a read.
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs',
      headers: { cookie: fresh.cookie },
    });
    const item = (
      list.json() as { items: Array<{ id: string; match?: { scoreable?: boolean } }> }
    ).items.find((entry) => entry.id === job.id);
    expect(item?.match?.scoreable).toBe(false);
    // The card summary must not describe gaps we cannot possibly know about.
    expect((item?.match as { summary?: string }).summary).toMatch(
      /not enough verified information/i,
    );
  });

  it('flips to scoreable once a verified fact exists', async () => {
    const fresh = await signUp('one-fact@example.test');
    const job = await seedJob();

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/facts',
      headers: { cookie: fresh.cookie },
      payload: { kind: 'skill', label: 'TypeScript', keywords: ['typescript'] },
    });
    expect(created.statusCode).toBe(201);
    const factId = (created.json() as { fact: { id: string } }).fact.id;

    const verified = await app.inject({
      method: 'POST',
      url: '/api/v1/profile/facts/verify',
      headers: { cookie: fresh.cookie },
      payload: { factIds: [factId], verified: true },
    });
    expect(verified.statusCode).toBe(200);

    const recomputed = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${job.id}/match`,
      headers: { cookie: fresh.cookie },
      payload: {},
    });
    expect((recomputed.json() as { match: { scoreable: boolean } }).match.scoreable).toBe(true);
  });
});

describe('personal data is never cacheable', () => {
  it('marks authenticated responses private and non-storable', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/dashboard', headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store, private');
  });

  it('leaves public operational endpoints cacheable by default', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBeUndefined();
  });
});

describe('bug — a disabled feature answered with a validation error', () => {
  it('reports feature_disabled before validating the body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/browser-sessions',
      headers: auth(),
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe('feature_disabled');
  });

  it('says the same for every browser route, malformed id or not', async () => {
    const cases: Array<{ method: 'GET' | 'POST'; url: string }> = [
      { method: 'POST', url: '/api/v1/browser-sessions/not-a-uuid/plan' },
      { method: 'POST', url: '/api/v1/browser-sessions/not-a-uuid/fields' },
      { method: 'POST', url: '/api/v1/browser-sessions/not-a-uuid/pause' },
      { method: 'POST', url: '/api/v1/browser-sessions/not-a-uuid/end' },
    ];
    for (const { method, url } of cases) {
      const response = await app.inject({ method, url, headers: auth(), payload: {} });
      expect(response.statusCode, url).toBe(403);
      expect((response.json() as { error: { code: string } }).error.code, url).toBe(
        'feature_disabled',
      );
    }
  });
});
