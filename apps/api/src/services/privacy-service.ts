/** Retention and privacy helpers (pure queries so they are easy to test). */

import type { Database } from '../db/client.js';
import { RETENTION } from '@job-hunter/config';

export async function summarizeDataExport(db: Database, userId: string) {
  const [resumes, facts, matches, documents, applications, sessions, notifications, auditEvents] =
    await Promise.all([
      db.resume.count({ where: { userId, deletedAt: null } }),
      db.profileFact.count({ where: { userId } }),
      db.jobMatch.count({ where: { userId } }),
      db.generatedDocument.count({ where: { userId } }),
      db.application.count({ where: { userId } }),
      db.browserSession.count({ where: { userId } }),
      db.notification.count({ where: { userId } }),
      db.auditEvent.count({ where: { userId } }),
    ]);

  return {
    counts: {
      resumes,
      facts,
      matches,
      documents,
      applications,
      sessions,
      notifications,
      auditEvents,
    },
    retention: RETENTION,
    note: 'Export downloads everything we store about you as JSON. Deletion removes it permanently.',
  };
}

/**
 * Retention maintenance: deletes data older than the published windows.
 * Returns counts so the caller can log/notify; safe to run repeatedly.
 */
export async function runRetention(
  db: Database,
  options: { now?: Date | undefined; dryRun?: boolean | undefined } = {},
) {
  const now = options.now ?? new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

  const targets = {
    auditEvents: { createdAt: { lt: daysAgo(RETENTION.auditEventDays) } },
    browserSessions: {
      createdAt: { lt: daysAgo(RETENTION.browserSessionDays) },
      endedAt: { not: null },
    },
    notifications: {
      createdAt: { lt: daysAgo(RETENTION.notificationDays) },
      readAt: { not: null },
    },
    expiredSessions: {
      expiresAt: { lt: daysAgo(1) },
      status: { in: ['pending_consent', 'paused_for_user'] },
    },
  };

  if (options.dryRun) {
    return {
      auditEvents: await db.auditEvent.count({ where: targets.auditEvents }),
      browserSessions: await db.browserSession.count({ where: targets.browserSessions }),
      notifications: await db.notification.count({ where: targets.notifications }),
      expiredSessions: await db.browserSession.count({ where: targets.expiredSessions }),
      dryRun: true,
    };
  }

  const [auditEvents, browserSessions, notifications, expiredSessions] = await Promise.all([
    db.auditEvent.deleteMany({ where: targets.auditEvents }),
    db.browserSession.deleteMany({ where: targets.browserSessions }),
    db.notification.deleteMany({ where: targets.notifications }),
    db.browserSession.deleteMany({ where: targets.expiredSessions }),
  ]);

  return {
    auditEvents: auditEvents.count,
    browserSessions: browserSessions.count + expiredSessions.count,
    notifications: notifications.count,
    dryRun: false,
  };
}

/**
 * Hard-delete accounts whose grace period has elapsed, and purge their files.
 * Files are deleted through the storage port by the caller before this runs.
 */
export async function purgeDeletedAccounts(db: Database, options: { now?: Date | undefined } = {}) {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - RETENTION.accountDeletionGraceDays * 86_400_000);

  const candidates = await db.user.findMany({
    where: { deletedAt: { not: null, lte: cutoff } },
    select: { id: true },
  });

  for (const candidate of candidates) {
    await db.user.delete({ where: { id: candidate.id } });
  }
  return { purged: candidates.length };
}
