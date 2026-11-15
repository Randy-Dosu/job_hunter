import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CONSENT_VERSIONS } from '@job-hunter/config';
import { signInSchema, signUpSchema, consentSchema } from '@job-hunter/validation';
import type { AppContext } from '../app.js';
import { errors } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';

export async function registerAuthRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  const { db, auth, env } = context;

  const clientIp = (request: FastifyRequest): string | undefined =>
    (request.ip || undefined) as string | undefined;
  const userAgent = (request: FastifyRequest): string | undefined =>
    typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined;

  const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: Date): void => {
    reply.setCookie(env.AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  };

  app.post('/auth/signup', async (request, reply) => {
    const limit = context.rateLimiters.auth.check(`signup:${request.ip}`);
    if (!limit.allowed) throw errors.rateLimited();

    const input = signUpSchema.parse(request.body);
    const result = await auth.signUp({
      ...input,
      ...(clientIp(request) ? { ip: clientIp(request) } : {}),
      ...(userAgent(request) ? { userAgent: userAgent(request) } : {}),
    });

    setSessionCookie(reply, result.token, result.expiresAt);
    return reply.status(201).send({ user: result.user });
  });

  app.post('/auth/signin', async (request, reply) => {
    const limit = context.rateLimiters.auth.check(`signin:${request.ip}`);
    if (!limit.allowed) throw errors.rateLimited();

    const input = signInSchema.parse(request.body);
    const result = await auth.signIn({
      ...input,
      ...(clientIp(request) ? { ip: clientIp(request) } : {}),
      ...(userAgent(request) ? { userAgent: userAgent(request) } : {}),
    });

    setSessionCookie(reply, result.token, result.expiresAt);
    return reply.send({ user: result.user });
  });

  app.post('/auth/signout', async (request, reply) => {
    const token = request.cookies[env.AUTH_COOKIE_NAME];
    if (token) {
      await auth.signOut(token, request.auth?.userId);
    }
    reply.clearCookie(env.AUTH_COOKIE_NAME, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/auth/me', async (request) => {
    if (!request.auth) throw errors.unauthorized();
    const user = await db.user.findUnique({
      where: { id: request.auth.userId },
      select: { id: true, email: true, displayName: true, role: true, createdAt: true },
    });
    if (!user) throw errors.unauthorized();

    const consents = await db.userConsent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      distinct: ['kind'],
      select: { kind: true, granted: true, version: true, createdAt: true },
    });

    return {
      user: { ...user, createdAt: user.createdAt.toISOString() },
      consents: consents.map((consent) => ({
        ...consent,
        createdAt: consent.createdAt.toISOString(),
      })),
      consentVersions: CONSENT_VERSIONS,
    };
  });

  /** Record a consent decision (AI processing, browser assistance, etc.). */
  app.post('/auth/consents', async (request, reply) => {
    if (!request.auth) throw errors.unauthorized();
    const input = consentSchema.parse(request.body);

    // Terms and privacy cannot be "ungranted" while continuing to use the product.
    if ((input.kind === 'terms' || input.kind === 'privacy') && !input.granted) {
      throw errors.validation('Withdrawing this consent requires deleting your account');
    }

    const consent = await db.userConsent.create({
      data: {
        userId: request.auth.userId,
        kind: input.kind,
        granted: input.granted,
        version: input.version,
        ...(clientIp(request) ? { ip: clientIp(request) } : {}),
      },
    });
    await recordAudit(db, context.logger, {
      userId: request.auth.userId,
      action: 'consent.recorded',
      entityType: 'consent',
      entityId: consent.id,
    });
    return reply.status(201).send({
      consent: { ...consent, createdAt: consent.createdAt.toISOString() },
    });
  });
}
