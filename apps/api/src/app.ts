/**
 * Fastify application assembly.
 *
 * Everything is injected through `AppContext` so the same app runs in tests with
 * an in-memory database, a mock AI provider and a temp storage directory.
 */

import { randomUUID } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import type { Env } from '@job-hunter/config';
import { API_PREFIX, APP_VERSION } from '@job-hunter/config';
import type { Database } from './db/client.js';
import { AppError, errors } from './lib/errors.js';
import { createLogger, type Logger } from './lib/logger.js';
import { createRateLimiter, type RateLimiter } from './lib/rate-limit.js';
import type { FileStorage } from './lib/storage.js';
import type { AuthService } from './services/auth-service.js';
import type { AIGateway } from '@job-hunter/ai-gateway';
import { registerRoutes } from './routes/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; email: string; role: string } | undefined;
    logger: Logger;
  }
}

export interface AppContext {
  env: Env;
  db: Database;
  logger: Logger;
  storage: FileStorage;
  auth: AuthService;
  ai: AIGateway;
  rateLimiters: {
    auth: RateLimiter;
    scan: RateLimiter;
    ai: RateLimiter;
    upload: RateLimiter;
  };
  now?: (() => Date) | undefined;
}

export interface BuildAppOptions {
  context: AppContext;
  fastifyOptions?: FastifyServerOptions | undefined;
}

export async function buildApp({
  context,
  fastifyOptions,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MB JSON limit; uploads use multipart with their own cap
    genReqId: () => randomUUID(),
    // Fastify's own request logging is replaced by our structured logger, which
    // redacts secrets and adds a request id to every line.
    logController: new LogController({ disableRequestLogging: true }),
    ...fastifyOptions,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // set by the web app host
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie, {});
  await app.register(cors, {
    origin: (origin: string | undefined, callback: (err: Error | null, allow: boolean) => void) => {
      if (!origin) return callback(null, true); // same-origin / server-to-server
      const allowed = context.env.WEB_ORIGIN.split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      // In development, allow the live preview host pattern used by the sandbox.
      const isLocalhost = /^http:\/\/localhost(:\d+)?$/.test(origin);
      const isPreview = /^https:\/\/[a-z0-9-]+\.e2b\.app$/.test(origin);
      const isArena = /^https:\/\/[a-z0-9-]+\.arena\.(ai|dev)$/.test(origin);
      if (allowed.includes(origin) || isLocalhost || isPreview || isArena) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  });
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
    throwFileSizeLimit: false,
  });

  // ---- request lifecycle ---------------------------------------------------
  app.addHook('onRequest', async (request, reply) => {
    const requestLogger = context.logger.child({
      requestId: request.id,
      method: request.method,
      route: request.url.split('?')[0],
    });
    request.logger = requestLogger;

    // Authenticate from the session cookie (never from a header the client sets).
    const cookieName = context.env.AUTH_COOKIE_NAME;
    const token = request.cookies[cookieName];
    if (token) {
      const user = await context.auth.resolveSession(token);
      if (user) {
        request.auth = { userId: user.id, email: user.email, role: user.role };
        request.logger = requestLogger.child({ userId: user.id });
      }
    }
    reply.header('x-request-id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    request.logger.info('request completed', {
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    });
  });

  // ---- error handling ------------------------------------------------------
  app.setErrorHandler((rawError, request, reply) => {
    const error = rawError as Error & { statusCode?: number };
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.logger.error('request failed', { code: error.code, message: error.message });
      } else {
        request.logger.info('request rejected', { code: error.code, statusCode: error.statusCode });
      }
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.expose ? error.message : 'Something went wrong on our side',
          ...(error.details ? { details: error.details } : {}),
          requestId: request.id,
        },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: {
          code: 'validation_failed',
          message: 'Please check the highlighted fields',
          details: zodDetails(error),
          requestId: request.id,
        },
      });
    }

    // Fastify's own errors (bad JSON, multipart limits, etc.)
    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode < 500) {
      const code =
        statusCode === 413
          ? 'payload_too_large'
          : statusCode === 415
            ? 'unsupported_media_type'
            : 'bad_request';
      return reply.status(statusCode).send({
        error: {
          code,
          message:
            code === 'payload_too_large' ? 'That file is too large (5 MB maximum)' : error.message,
          requestId: request.id,
        },
      });
    }

    request.logger.error('unhandled error', {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join(' | '),
    });
    return reply.status(500).send({
      error: {
        code: 'internal_error',
        message: 'Something went wrong on our side',
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'not_found',
        message: `No route for ${request.method} ${request.url}`,
        requestId: request.id,
      },
    });
  });

  // ---- operational endpoints ----------------------------------------------
  app.get('/health', async (_request, reply) => {
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
    try {
      await context.db.$queryRaw`SELECT 1`;
      checks.push({ name: 'database', ok: true });
    } catch (error) {
      checks.push({
        name: 'database',
        ok: false,
        detail: error instanceof Error ? error.message.slice(0, 120) : 'unavailable',
      });
    }
    const ai = context.ai.health();
    checks.push({
      name: 'ai_provider',
      ok: ai.some((provider) => provider.configured),
      detail: ai.map((p) => `${p.id}:${p.configured ? 'on' : 'off'}`).join(','),
    });

    const ok = checks.every((check) => check.ok || check.name === 'ai_provider');
    return reply.status(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      version: APP_VERSION,
      time: new Date().toISOString(),
      checks,
    });
  });

  app.get(`${API_PREFIX}/meta`, async () => ({
    name: 'Job Hunter API',
    version: APP_VERSION,
    features: {
      browserAssistant: context.env.FEATURE_BROWSER_ASSISTANT,
      notifications: context.env.FEATURE_NOTIFICATIONS,
    },
    aiProviders: context.ai.health(),
  }));

  await app.register(
    async (instance) => {
      await registerRoutes(instance, context);
    },
    { prefix: API_PREFIX },
  );

  return app;
}

export function zodDetails(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    details[key] = [...(details[key] ?? []), issue.message];
  }
  return details;
}

/** Create the default context pieces that do not depend on the database. */
export function createBaseContext(env: Env): Pick<AppContext, 'rateLimiters'> {
  return {
    rateLimiters: {
      auth: createRateLimiter({ limit: env.RATE_LIMIT_AUTH_PER_MIN, windowMs: 60_000 }),
      scan: createRateLimiter({ limit: env.RATE_LIMIT_SCAN_PER_HOUR, windowMs: 3_600_000 }),
      ai: createRateLimiter({ limit: env.RATE_LIMIT_AI_PER_HOUR, windowMs: 3_600_000 }),
      upload: createRateLimiter({ limit: 10, windowMs: 3_600_000 }),
    },
  };
}

export { createLogger, errors };
