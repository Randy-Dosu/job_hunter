import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireUser } from './guards.js';
import { evaluateSchedule } from '@job-hunter/worker';

export async function registerDashboardRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db } = context;

  /** Everything the dashboard needs in one request (keeps the UI fast and simple). */
  app.get('/dashboard', async (request) => {
    const user = requireUser(request);
    const since24h = new Date(Date.now() - 86_400_000);

    const [
      newJobCount,
      totalJobCount,
      highMatchCount,
      applicationCounts,
      lastScan,
      upcomingActions,
      unreadNotifications,
      schedule,
      verifiedFacts,
      unverifiedFacts,
      resumeCount,
      documentsAwaitingReview,
      awaitingReviewCount,
    ] = await Promise.all([
      db.job.count({ where: { firstSeenAt: { gte: since24h }, status: 'active' } }),
      db.job.count({ where: { status: 'active' } }),
      db.jobMatch.count({ where: { userId: user.userId, score: { gte: 75 }, excluded: false } }),
      db.application.groupBy({
        by: ['status'],
        where: { userId: user.userId, archivedAt: null },
        _count: { _all: true },
      }),
      db.scanRun.findFirst({
        where: { userId: user.userId },
        orderBy: { startedAt: 'desc' },
        include: { sourceRuns: true },
      }),
      db.application.findMany({
        where: {
          userId: user.userId,
          archivedAt: null,
          nextActionAt: { not: null, lte: new Date(Date.now() + 7 * 86_400_000) },
        },
        orderBy: { nextActionAt: 'asc' },
        take: 5,
        include: { job: { select: { title: true, company: true } } },
      }),
      db.notification.count({ where: { userId: user.userId, readAt: null } }),
      db.scanSchedule.findUnique({ where: { userId: user.userId } }),
      db.profileFact.count({ where: { userId: user.userId, verified: true } }),
      db.profileFact.count({ where: { userId: user.userId, verified: false } }),
      db.resume.count({ where: { userId: user.userId, deletedAt: null } }),
      db.generatedDocument.count({
        where: { userId: user.userId, status: { in: ['draft', 'needs_review'] } },
      }),
      // Applications the system prepared that are waiting on the user.
      db.application.count({
        where: { userId: user.userId, archivedAt: null, status: 'ready_for_user' },
      }),
    ]);

    const topMatches = await db.jobMatch.findMany({
      where: { userId: user.userId, excluded: false },
      orderBy: { score: 'desc' },
      take: 5,
      include: {
        job: {
          select: {
            id: true,
            title: true,
            company: true,
            locationRaw: true,
            remote: true,
            source: true,
            freshness: true,
          },
        },
      },
    });

    const scheduleDecision = schedule
      ? evaluateSchedule({
          enabled: schedule.enabled,
          timeZone: schedule.timeZone,
          hourLocal: schedule.hourLocal,
          lastRunAt: schedule.lastRunAt ?? undefined,
          now: new Date(),
        })
      : undefined;

    return {
      jobs: {
        total: totalJobCount,
        newLast24h: newJobCount,
        highMatches: highMatchCount,
        topMatches: topMatches
          .filter((match) => match.job)
          .map((match) => ({
            jobId: match.jobId,
            score: match.score,
            band: match.band,
            title: match.job.title,
            company: match.job.company,
            location: match.job.locationRaw,
            remote: match.job.remote,
            source: match.job.source,
            freshness: match.job.freshness,
          })),
      },
      applications: {
        total: applicationCounts.reduce((sum, row) => sum + row._count._all, 0),
        awaitingReview: awaitingReviewCount,
        byStatus: Object.fromEntries(applicationCounts.map((row) => [row.status, row._count._all])),
        upcoming: upcomingActions.map((application) => ({
          id: application.id,
          status: application.status,
          nextActionAt: application.nextActionAt?.toISOString() ?? null,
          job: application.job,
        })),
      },
      scan: lastScan
        ? {
            id: lastScan.id,
            status: lastScan.status,
            startedAt: lastScan.startedAt.toISOString(),
            finishedAt: lastScan.finishedAt?.toISOString() ?? null,
            jobsFound: lastScan.jobsFound,
            jobsNew: lastScan.jobsNew,
            errorSummary: lastScan.errorSummary,
            sources: lastScan.sourceRuns.map((sourceRun) => ({
              source: sourceRun.sourceId,
              status: sourceRun.status,
              fetched: sourceRun.fetched,
              error: sourceRun.error,
            })),
          }
        : null,
      schedule: schedule
        ? {
            enabled: schedule.enabled,
            timeZone: schedule.timeZone,
            scanHourLocal: schedule.hourLocal,
            lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
            nextRunAt: scheduleDecision?.nextRunAt.toISOString() ?? null,
            dueNow: scheduleDecision?.due ?? false,
          }
        : null,
      profile: {
        verifiedFacts,
        unverifiedFacts,
        resumes: resumeCount,
        ready: verifiedFacts > 0 && resumeCount > 0,
      },
      documents: { awaitingReview: documentsAwaitingReview },
      notifications: { unread: unreadNotifications },
    };
  });
}
