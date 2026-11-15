import type { FastifyInstance } from 'fastify';
import { idParamSchema, startScanSchema } from '@job-hunter/validation';
import { LIMITS } from '@job-hunter/config';
import type { AppContext } from '../app.js';
import { errors } from '../lib/errors.js';
import { requireUser } from './guards.js';
import { ScanService } from '../services/scan-service.js';
import { recordAudit } from '../lib/audit.js';

export async function registerScanRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  const { db, env } = context;
  const scanService = new ScanService({
    db,
    logger: context.logger,
    userAgent: env.JOB_USER_AGENT,
    ...(context.now ? { now: context.now } : {}),
    // Enables automatic application preparation after scoring.
    ai: context.ai,
  });

  /** Manual scan — the primary "find jobs now" action. */
  app.post('/scans', async (request, reply) => {
    const user = requireUser(request);

    const limit = context.rateLimiters.scan.check(`scan:${user.userId}`);
    if (!limit.allowed) {
      throw errors.rateLimited(
        `You can run ${env.RATE_LIMIT_SCAN_PER_HOUR} scans per hour. Try again in ${limit.retryAfterSeconds}s.`,
      );
    }

    const input = startScanSchema.parse(request.body ?? {});

    const since = new Date(Date.now() - 86_400_000);
    const recent = await db.scanRun.count({
      where: { userId: user.userId, startedAt: { gte: since }, trigger: 'manual' },
    });
    if (recent >= LIMITS.maxScansPerDay) {
      throw errors.rateLimited(
        `You have reached ${LIMITS.maxScansPerDay} manual scans in 24 hours.`,
      );
    }

    // Reject overlapping runs instead of queueing duplicate work.
    const running = await db.scanRun.findFirst({
      where: { userId: user.userId, status: { in: ['queued', 'running'] } },
    });
    if (running) throw errors.conflict('A scan is already running. Wait for it to finish.');

    const summary = await scanService.runForUser({
      userId: user.userId,
      trigger: 'manual',
      ...(input.sources ? { sources: input.sources } : {}),
      limitPerSource: input.limitPerSource,
    });

    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: summary.status === 'failed' ? 'scan.failed' : 'scan.completed',
      entityType: 'scan_run',
      entityId: summary.scanRunId,
    });

    return reply.status(201).send({ scan: summary });
  });

  app.get('/scans', async (request) => {
    const user = requireUser(request);
    const runs = await db.scanRun.findMany({
      where: { userId: user.userId },
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: { sourceRuns: true },
    });

    return {
      scans: runs.map((run) => ({
        id: run.id,
        trigger: run.trigger,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        jobsFound: run.jobsFound,
        jobsNew: run.jobsNew,
        jobsUpdated: run.jobsUpdated,
        errorSummary: run.errorSummary,
        sources: run.sourceRuns.map((sourceRun) => ({
          source: sourceRun.sourceId,
          status: sourceRun.status,
          fetched: sourceRun.fetched,
          durationMs: sourceRun.durationMs,
          error: sourceRun.error,
          note: sourceRun.note,
        })),
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/scans/:id', async (request) => {
    const user = requireUser(request);
    const { id } = idParamSchema.parse(request.params);
    const run = await db.scanRun.findFirst({
      where: { id: id, userId: user.userId },
      include: { sourceRuns: true },
    });
    if (!run) throw errors.notFound('Scan not found');
    return {
      scan: {
        id: run.id,
        trigger: run.trigger,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        jobsFound: run.jobsFound,
        jobsNew: run.jobsNew,
        jobsUpdated: run.jobsUpdated,
        errorSummary: run.errorSummary,
        sources: run.sourceRuns.map((sourceRun) => ({
          source: sourceRun.sourceId,
          status: sourceRun.status,
          fetched: sourceRun.fetched,
          durationMs: sourceRun.durationMs,
          error: sourceRun.error,
          note: sourceRun.note,
        })),
      },
    };
  });

  /** Source health panel data. */
  app.get('/sources/health', async (request) => {
    requireUser(request);
    const sources = await db.jobSource.findMany({ orderBy: { id: 'asc' } });
    return {
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        accessMethod: source.accessMethod,
        healthState: source.healthState,
        consecutiveFailures: source.consecutiveFailures,
        lastSuccessAt: source.lastSuccessAt?.toISOString() ?? null,
        lastFailureAt: source.lastFailureAt?.toISOString() ?? null,
        lastError: source.lastError,
      })),
    };
  });
}
