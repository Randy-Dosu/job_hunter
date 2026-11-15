import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sessionCookie, startHarness, type TestHarness } from './harness.js';

let harness: TestHarness;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startHarness();
  app = harness.app;
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

// Signup requires an explicit terms acceptance; the API rejects anything else.
const credentials = (suffix = '') => ({
  email: `ama${suffix}@example.test`,
  password: 'correct horse battery staple',
  displayName: 'Ama Mensah',
  acceptedTerms: true as const,
});

async function signup(suffix = '') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: credentials(suffix),
  });
  return response;
}

describe('signup and session bootstrap', () => {
  it('creates an account, sets an HttpOnly session cookie, and returns the user', async () => {
    const response = await signup('1');
    expect(response.statusCode).toBe(201);

    const body = response.json() as {
      user: { id: string; email: string; role: string };
      expiresAt: string;
    };
    expect(body.user.email).toBe(credentials('1').email);
    expect(body.user.role).toBe('user');
    expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/);

    const cookie = response.cookies[0];
    expect(cookie?.name).toBe('jh_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');

    // The raw token must never be stored; only its hash.
    const tokens = await harness.db.refreshToken.findMany({ where: { userId: body.user.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.tokenHash).not.toBe(cookie?.value);
    expect(tokens[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('bootstraps a profile, job preferences, a daily scan schedule and consents', async () => {
    const response = await signup('2');
    const userId = (response.json() as { user: { id: string } }).user.id;

    const [profile, preferences, schedule, consents] = await Promise.all([
      harness.db.candidateProfile.findUnique({ where: { userId } }),
      harness.db.jobPreferences.findUnique({ where: { userId } }),
      harness.db.scanSchedule.findUnique({ where: { userId } }),
      harness.db.userConsent.findMany({ where: { userId } }),
    ]);

    expect(profile).not.toBeNull();
    expect(preferences).not.toBeNull();
    expect(schedule).toMatchObject({ enabled: true });
    expect(consents.length).toBeGreaterThanOrEqual(3);
    // Consents must be recorded with a version so re-consent can be detected.
    for (const consent of consents) expect(consent.version).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('rejects a duplicate email with a stable error code', async () => {
    await signup('3');
    const duplicate = await signup('3');
    expect(duplicate.statusCode).toBe(409);
    const body = duplicate.json() as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('conflict');
    expect(body.error.requestId).toBeTruthy();
  });

  it('rejects a weak password and an invalid email', async () => {
    const weak = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'weak@example.test',
        password: 'short',
        displayName: 'Weak',
        acceptedTerms: true,
      },
    });
    // 422 is the documented contract for a well-formed body that fails validation.
    expect(weak.statusCode).toBe(422);
    const weakBody = weak.json() as { error: { code: string; details?: Record<string, string[]> } };
    expect(weakBody.error.code).toBe('validation_failed');
    expect(weakBody.error.details?.password?.join(' ')).toMatch(/at least 12 characters/i);

    const badEmail = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'not-an-email',
        password: 'correct horse battery staple',
        displayName: 'X',
        acceptedTerms: true,
      },
    });
    expect(badEmail.statusCode).toBe(422);
    expect(
      (badEmail.json() as { error: { details: Record<string, string[]> } }).error.details.email,
    ).toBeDefined();
  });

  it('does not reveal whether an email exists on failed login', async () => {
    await signup('4');

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      payload: { email: credentials('4').email, password: 'wrong password entirely' },
    });
    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      payload: { email: 'nobody@example.test', password: 'wrong password entirely' },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect((wrongPassword.json() as { error: { code: string } }).error.code).toBe(
      (unknownEmail.json() as { error: { code: string } }).error.code,
    );
  });
});

describe('session lifecycle', () => {
  it('returns the current user for a valid cookie and 401 without one', async () => {
    const created = await signup('5');
    const cookie = sessionCookie(created.headers['set-cookie']);

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { email: string } }).user.email).toBe(credentials('5').email);

    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(anonymous.statusCode).toBe(401);
    expect((anonymous.json() as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('rejects a forged session token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: 'jh_session=not-a-real-token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('revokes the session on logout', async () => {
    const created = await signup('6');
    const cookie = sessionCookie(created.headers['set-cookie']);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);

    const after = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('logs in with the correct password and issues a fresh session', async () => {
    await signup('7');
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      payload: { email: credentials('7').email, password: credentials('7').password },
    });
    expect(login.statusCode).toBe(200);
    const cookie = sessionCookie(login.headers['set-cookie']);

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
  });

  it('revokes every session when the password changes', async () => {
    const created = await signup('8');
    const userId = (created.json() as { user: { id: string } }).user.id;
    const first = sessionCookie(created.headers['set-cookie']);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      payload: { email: credentials('8').email, password: credentials('8').password },
    });
    const secondCookie = sessionCookie(second.headers['set-cookie']);

    const changed = await app.inject({
      method: 'POST',
      url: '/api/v1/privacy/password',
      headers: { cookie: secondCookie },
      payload: {
        currentPassword: credentials('8').password,
        newPassword: 'a brand new passphrase entirely',
      },
    });
    expect(changed.statusCode).toBe(200);

    for (const cookie of [first, secondCookie]) {
      const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
      expect(me.statusCode).toBe(401);
    }

    const tokens = await harness.db.refreshToken.findMany({ where: { userId, revokedAt: null } });
    expect(tokens).toHaveLength(0);

    const oldPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      payload: { email: credentials('8').email, password: credentials('8').password },
    });
    expect(oldPassword.statusCode).toBe(401);

    const newPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      payload: { email: credentials('8').email, password: 'a brand new passphrase entirely' },
    });
    expect(newPassword.statusCode).toBe(200);
  });

  it('stores passwords only as a salted scrypt hash', async () => {
    const created = await signup('9');
    const userId = (created.json() as { user: { id: string } }).user.id;
    const user = await harness.db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(user.passwordHash).not.toContain(credentials('9').password);
  });
});

describe('rate limiting and hardening', () => {
  it('sets hardening headers on every response', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['referrer-policy']).toBeDefined();
    expect(response.headers['cross-origin-opener-policy']).toBeDefined();
  });

  it('does not send permissive CORS headers to arbitrary origins', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();

    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: harness.context.env.WEB_ORIGIN.split(',')[0]!.trim() },
    });
    expect(allowed.headers['access-control-allow-origin']).toBeDefined();
  });

  it('rejects an oversized JSON body instead of buffering it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signin',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'a@b.test', password: 'x'.repeat(2_000_000) },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });

  it('does not leak stack traces or internals on unexpected errors', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/jobs/definitely-not-a-uuid' });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const raw = response.body;
    expect(raw).not.toContain('at Object.');
    expect(raw).not.toContain('node_modules');
    expect(raw).not.toContain('prisma');
  });

  it('exposes the API version and a health endpoint without auth', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const meta = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(meta.statusCode).toBe(200);
    const body = meta.json() as {
      version: string;
      features: Record<string, boolean>;
      aiProviders: unknown[];
    };
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.features).toHaveProperty('browserAssistant');
    expect(Array.isArray(body.aiProviders)).toBe(true);
  });
});
