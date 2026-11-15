/**
 * Notification service.
 *
 * In-app notifications only (the plan lets us choose; transactional email is not
 * assumed available on a free tier). Deduplication is enforced by a unique
 * (userId, dedupeKey) constraint, so retries cannot spam the user.
 */

import type { Database } from '../db/client.js';
import type { Logger } from '../lib/logger.js';
import type { NotificationKind } from '@job-hunter/shared-types';

export interface NotificationServiceOptions {
  db: Database;
  logger: Logger;
}

export class NotificationService {
  constructor(private readonly options: NotificationServiceOptions) {}

  async create(input: {
    userId: string;
    kind: NotificationKind | string;
    title: string;
    body?: string | undefined;
    link?: string | undefined;
    dedupeKey: string;
  }): Promise<{ id: string; created: boolean }> {
    try {
      const notification = await this.options.db.notification.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          title: input.title.slice(0, 200),
          body: input.body?.slice(0, 1000) ?? null,
          link: input.link?.slice(0, 500) ?? null,
          dedupeKey: input.dedupeKey.slice(0, 200),
        },
      });
      return { id: notification.id, created: true };
    } catch (error) {
      // P2002 = duplicate dedupeKey: the user already received this notification.
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        const existing = await this.options.db.notification.findFirst({
          where: { userId: input.userId, dedupeKey: input.dedupeKey.slice(0, 200) },
          select: { id: true },
        });
        return { id: existing?.id ?? 'unknown', created: false };
      }
      this.options.logger.warn('notification failed', {
        kind: input.kind,
        error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      });
      return { id: 'unknown', created: false };
    }
  }

  /** One digest-style notification per scan, never one per job. */
  async notifyScanComplete(input: {
    userId: string;
    scanRunId: string;
    jobsNew: number;
    jobsFound: number;
    status: string;
  }): Promise<{ id: string; created: boolean }> {
    const kind: NotificationKind = input.status === 'failed' ? 'scan_failed' : 'scan_completed';
    const title =
      input.status === 'failed'
        ? 'Your scan could not complete'
        : input.jobsNew > 0
          ? `${input.jobsNew} new job${input.jobsNew === 1 ? '' : 's'} found`
          : 'Scan finished — no new jobs this time';

    const body =
      input.status === 'failed'
        ? 'Some sources could not be reached. Check the scan details for which ones.'
        : `${input.jobsFound} listing${input.jobsFound === 1 ? '' : 's'} checked from your sources.`;

    return this.create({
      userId: input.userId,
      kind,
      title,
      body,
      link: '/jobs',
      dedupeKey: `scan:${input.scanRunId}`,
    });
  }

  async notifyHighMatch(input: {
    userId: string;
    jobId: string;
    score: number;
    title: string;
    company: string;
  }): Promise<{ id: string; created: boolean }> {
    return this.create({
      userId: input.userId,
      kind: 'high_match_found',
      title: `${input.score}% match: ${input.title}`,
      body: `${input.company} — reviewed against your verified profile.`,
      link: `/jobs/${input.jobId}`,
      dedupeKey: `high-match:${input.userId}:${input.jobId}`,
    });
  }
}
