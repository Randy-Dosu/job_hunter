/**
 * Scan service: fetch -> normalise -> deduplicate -> persist -> score.
 *
 * Guarantees:
 *  - one failing source never aborts the run (per-source isolation),
 *  - retries cannot duplicate jobs or scans (idempotency keys + dedupe keys),
 *  - every ingest records source attribution and freshness timestamps.
 */

import type { Database } from '../db/client.js';
import type { Logger } from '../lib/logger.js';
import type { JobPreferences, RawJob } from '@job-hunter/shared-types';
import { LIMITS } from '@job-hunter/config';
import { getEnabledConnectors } from '@job-hunter/job-connectors';
import type { JobConnector } from '@job-hunter/job-connectors';
import { runScan } from '@job-hunter/worker';
import { dedupeKeyOf, freshnessOf } from '@job-hunter/worker';
import {
  resolveCountryCode,
  inferSeniority,
  normalizeEmploymentType,
} from '@job-hunter/job-connectors';
import { parseSalaryRange } from '@job-hunter/matching';
import { toJobPreferences } from './auth-service.js';
import { scoreJob } from '@job-hunter/matching';
import { toFactDto } from '../routes/profile.js';
import { NotificationService } from './notification-service.js';
import { PreparationService } from './preparation-service.js';
import type { AIGateway } from '@job-hunter/ai-gateway';

export interface ScanServiceOptions {
  db: Database;
  logger: Logger;
  userAgent: string;
  fetchImpl?: typeof globalThis.fetch | undefined;
  now?: (() => Date) | undefined;
  maxPagesPerSource?: number | undefined;
  /** Needed for automatic application preparation; omitted in scan-only tests. */
  ai?: AIGateway | undefined;
}

export interface ScanSummary {
  scanRunId: string;
  status: string;
  jobsFound: number;
  jobsNew: number;
  jobsUpdated: number;
  sources: Array<{
    source: string;
    status: string;
    fetched: number;
    durationMs: number;
    error?: string | undefined;
    note?: string | undefined;
  }>;
  startedAt: string;
  finishedAt?: string | undefined;
}

export class ScanService {
  private readonly notifications: NotificationService;

  constructor(private readonly options: ScanServiceOptions) {
    this.notifications = new NotificationService({ db: options.db, logger: options.logger });
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /**
   * Execute a scan for a user.
   *
   * `idempotencyKey` makes the operation safe to retry: a second call with the
   * same key returns the existing run instead of starting new work.
   */
  async runForUser(input: {
    userId: string;
    trigger: 'manual' | 'scheduled';
    sources?: string[] | undefined;
    limitPerSource?: number | undefined;
    idempotencyKey?: string | undefined;
  }): Promise<ScanSummary> {
    const { db } = this.options;

    if (input.idempotencyKey) {
      const existing = await db.scanRun.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { sourceRuns: true },
      });
      if (existing) {
        return this.toSummary(existing, existing.sourceRuns);
      }
    }

    const prefsRow = await db.jobPreferences.findUnique({ where: { userId: input.userId } });
    if (!prefsRow) throw new Error('Job preferences are not configured');

    const preferences: JobPreferences = toJobPreferences(prefsRow);
    const requested =
      input.sources && input.sources.length > 0 ? input.sources : preferences.enabledSources;

    const connectors = getEnabledConnectors(requested);
    const limitPerSource = Math.min(
      input.limitPerSource ?? LIMITS.pageSizeDefault,
      Math.max(1, Math.floor(LIMITS.maxJobsPerScan / Math.max(1, connectors.length))),
    );

    const scanRun = await db.scanRun.create({
      data: {
        userId: input.userId,
        trigger: input.trigger,
        status: 'running',
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      },
    });

    await this.syncSourceRegistry(connectors, requested);

    const engineResult = await runScan({
      connectors,
      preferences,
      limitPerSource,
      ...(this.options.maxPagesPerSource
        ? { maxPagesPerSource: this.options.maxPagesPerSource }
        : {}),
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      userAgent: this.options.userAgent,
      logger: {
        info: (message, meta) => this.options.logger.info(message, meta as Record<string, unknown>),
        warn: (message, meta) => this.options.logger.warn(message, meta as Record<string, unknown>),
      },
      now: () => this.now(),
    });

    // Persist per-source runs first so failures are visible even if ingest fails.
    for (const outcome of engineResult.outcomes) {
      await db.jobSourceRun.upsert({
        where: { scanRunId_sourceId: { scanRunId: scanRun.id, sourceId: outcome.source } },
        create: {
          scanRunId: scanRun.id,
          sourceId: outcome.source,
          status: outcome.status,
          fetched: outcome.fetched,
          durationMs: outcome.durationMs,
          error: outcome.error ?? null,
          note: outcome.note ?? null,
        },
        update: {
          status: outcome.status,
          fetched: outcome.fetched,
          durationMs: outcome.durationMs,
          error: outcome.error ?? null,
          note: outcome.note ?? null,
        },
      });
      await this.updateSourceHealth(outcome);
    }

    const ingest = await this.ingestListings({
      userId: input.userId,
      jobs: engineResult.jobs,
      preferences,
    });

    const status = engineResult.status;
    const errorSummary =
      engineResult.outcomes
        .filter((outcome) => outcome.status === 'failed')
        .map((outcome) => `${outcome.source}: ${outcome.error ?? 'failed'}`)
        .join('; ') || null;

    const finished = await db.scanRun.update({
      where: { id: scanRun.id },
      data: {
        status,
        finishedAt: this.now(),
        jobsFound: engineResult.jobs.length,
        jobsNew: ingest.created,
        jobsUpdated: ingest.updated,
        errorSummary,
      },
      include: { sourceRuns: true },
    });

    // Automatic application preparation runs *after* scoring, so it can select
    // on the fresh match scores. It assembles packages; it never sends them.
    // A preparation failure must not fail the scan itself.
    if (this.options.ai) {
      try {
        const preparation = new PreparationService({
          db,
          logger: this.options.logger,
          ai: this.options.ai,
          now: () => this.now(),
        });
        const prepared = await preparation.prepareForUser({
          userId: input.userId,
          trigger: 'scheduled',
        });
        if (prepared.prepared > 0) {
          this.options.logger.info('auto-prepare: packages assembled', {
            userId: input.userId,
            prepared: prepared.prepared,
          });
        }
      } catch (error) {
        this.options.logger.warn('auto-prepare: run failed', {
          userId: input.userId,
          error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        });
      }
    }

    // Notify once per scan (deduplicated), and flag the best new matches.
    await this.notifications.notifyScanComplete({
      userId: input.userId,
      scanRunId: scanRun.id,
      jobsNew: ingest.created,
      jobsFound: engineResult.jobs.length,
      status,
    });

    if (ingest.created > 0 && status !== 'failed') {
      const best = await db.jobMatch.findMany({
        where: {
          userId: input.userId,
          jobId: { in: ingest.jobIds },
          score: { gte: 80 },
          excluded: false,
        },
        orderBy: { score: 'desc' },
        take: 3,
        include: { job: { select: { title: true, company: true } } },
      });
      for (const match of best) {
        if (!match.job) continue;
        await this.notifications.notifyHighMatch({
          userId: input.userId,
          jobId: match.jobId,
          score: match.score,
          title: match.job.title,
          company: match.job.company,
        });
      }
    }

    // The scheduler advances `lastRunAt` after a successful run.
    if (input.trigger === 'scheduled') {
      await db.scanSchedule.updateMany({
        where: { userId: input.userId },
        data: { lastRunAt: this.now(), lastScanRunId: scanRun.id },
      });
    }

    return this.toSummary(finished, finished.sourceRuns);
  }

  /** Upsert listings, preserving cross-source dedupe and freshness. */
  async ingestListings(input: {
    userId: string;
    jobs: RawJob[];
    preferences: JobPreferences;
    scoreAfterIngest?: boolean | undefined;
  }): Promise<{ created: number; updated: number; jobIds: string[]; skipped: number }> {
    const { db } = this.options;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const jobIds: string[] = [];

    for (const raw of input.jobs) {
      try {
        const sourceId = this.sourceIdOf(raw);
        const sourceKey = `${sourceId}:${raw.externalId}`.slice(0, 400);

        // 1) Already seen from the same source? (exact identity)
        const existingRecord = await db.jobSourceRecord.findUnique({ where: { sourceKey } });

        // 2) Otherwise look for the same role from any source (cross-source dedupe).
        const dedupeKey = dedupeKeyOf({
          source: sourceId,
          externalId: raw.externalId,
          url: raw.url,
          company: raw.company,
          title: raw.title,
          ...(raw.locationRaw ? { locationRaw: raw.locationRaw } : {}),
        });
        const existingJob = await db.job.findUnique({ where: { dedupeKey } });
        const canonicalJobId = existingRecord?.jobId ?? existingJob?.id;

        const salary =
          raw.salaryMin || raw.salaryMax
            ? {
                min: raw.salaryMin,
                max: raw.salaryMax,
                currency: raw.salaryCurrency,
                period: raw.salaryPeriod,
              }
            : parseSalaryRange(raw.salaryRaw);

        const countryCode = raw.countryHint ?? resolveCountryCode({ locationRaw: raw.locationRaw });
        const workplace =
          raw.remote === true
            ? 'remote'
            : raw.locationRaw && /remote/i.test(raw.locationRaw)
              ? 'remote'
              : 'unknown';
        const employmentType = normalizeEmploymentType(raw.employmentTypeHint);
        const seniority = inferSeniority(raw.title, raw.seniorityHint);
        const nowIso = this.now().toISOString();
        const freshness = freshnessOf({
          firstSeenAt: existingJob?.firstSeenAt.toISOString() ?? nowIso,
          ...(raw.postedAt ? { postedAt: raw.postedAt } : {}),
          ...(raw.expiresAt ? { expiresAt: raw.expiresAt } : {}),
          now: this.now(),
        });

        const jobData = {
          title: raw.title.slice(0, 300),
          company: raw.company.slice(0, 200),
          companyLogoUrl: raw.companyLogoUrl ?? null,
          description: raw.description,
          url: raw.url,
          source: sourceId,
          externalId: raw.externalId.slice(0, 300),
          locationRaw: raw.locationRaw ?? null,
          city: raw.cityHint ?? null,
          region: null,
          countryCode: countryCode ?? null,
          remote: workplace === 'remote',
          workplace,
          employmentType,
          seniority,
          salaryMin: salary.min ?? null,
          salaryMax: salary.max ?? null,
          salaryCurrency: salary.currency ?? null,
          salaryPeriod: salary.period ?? null,
          tags: (raw.tags ?? []).slice(0, 30),
          status: 'active',
          freshness,
          postedAt: raw.postedAt ? new Date(raw.postedAt) : null,
          expiresAt: raw.expiresAt ? new Date(raw.expiresAt) : null,
          lastSeenAt: this.now(),
          lastCheckedAt: this.now(),
        };

        let jobId: string;
        if (canonicalJobId) {
          const job = await db.job.update({
            where: { id: canonicalJobId },
            data: { ...jobData, dedupeKey: existingJob ? dedupeKey : undefined },
          });
          jobId = job.id;
          updated += 1;
        } else {
          const job = await db.job.create({
            data: { ...jobData, dedupeKey, firstSeenAt: this.now() },
          });
          jobId = job.id;
          created += 1;
        }
        jobIds.push(jobId);

        // Record the source-specific identity (attribution).
        await db.jobSourceRecord.upsert({
          where: { sourceKey },
          create: {
            jobId,
            sourceId,
            externalId: raw.externalId.slice(0, 300),
            url: raw.url,
            sourceKey,
          },
          update: { jobId, lastSeenAt: this.now(), url: raw.url },
        });
      } catch (error) {
        skipped += 1;
        this.options.logger.warn('listing ingest failed', {
          title: raw.title.slice(0, 80),
          error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        });
      }
    }

    if (input.scoreAfterIngest !== false && jobIds.length > 0) {
      await this.scoreJobs({ userId: input.userId, jobIds, preferences: input.preferences });
    }

    return { created, updated, jobIds, skipped };
  }

  /** Deterministic scoring for a set of jobs (verified facts only). */
  async scoreJobs(input: {
    userId: string;
    jobIds: string[];
    preferences: JobPreferences;
  }): Promise<number> {
    const { db } = this.options;
    const profile = await db.candidateProfile.findUnique({ where: { userId: input.userId } });
    if (!profile) return 0;

    const facts = await db.profileFact.findMany({
      where: { userId: input.userId, verified: true },
    });
    const factDtos = facts.map(toFactDto);
    const content = profile.content as unknown as Parameters<typeof scoreJob>[0]['profile'];

    let scored = 0;
    for (const jobId of input.jobIds.slice(0, 500)) {
      const job = await db.job.findUnique({ where: { id: jobId } });
      if (!job) continue;

      const result = scoreJob({
        job: {
          id: job.id,
          title: job.title,
          company: job.company,
          description: job.description,
          tags: job.tags,
          location: {
            ...(job.locationRaw ? { raw: job.locationRaw } : {}),
            ...(job.countryCode ? { countryCode: job.countryCode } : {}),
            remote: job.remote,
            workplace: job.workplace as 'remote' | 'hybrid' | 'onsite' | 'unknown',
          },
          employmentType: job.employmentType as never,
          seniority: job.seniority as never,
          salary: job.salaryMin
            ? {
                min: job.salaryMin,
                ...(job.salaryMax ? { max: job.salaryMax } : {}),
                ...(job.salaryCurrency ? { currency: job.salaryCurrency } : {}),
                period: (job.salaryPeriod ?? 'year') as never,
              }
            : undefined,
        },
        profile: content,
        verifiedFacts: factDtos,
        preferences: input.preferences,
      });

      await db.jobMatch.upsert({
        where: { userId_jobId: { userId: input.userId, jobId: job.id } },
        create: {
          userId: input.userId,
          jobId: job.id,
          score: result.score,
          band: result.band,
          scoreable: result.scoreable,
          scoringVersion: result.scoringVersion,
          profileVersion: result.profileVersion,
          components: result.components as never,
          evidence: result.evidence as never,
          gaps: result.gaps as never,
          usedSemantic: result.usedSemantic,
        },
        update: {
          score: result.score,
          band: result.band,
          scoreable: result.scoreable,
          scoringVersion: result.scoringVersion,
          profileVersion: result.profileVersion,
          components: result.components as never,
          evidence: result.evidence as never,
          gaps: result.gaps as never,
          computedAt: this.now(),
        },
      });
      scored += 1;
    }
    return scored;
  }

  /** The scan engine tags each listing with its connector id. */
  private sourceIdOf(raw: RawJob): string {
    return raw.source ?? 'unknown';
  }

  private async syncSourceRegistry(
    connectors: JobConnector[],
    requested: readonly string[],
  ): Promise<void> {
    for (const connector of connectors) {
      await this.options.db.jobSource.upsert({
        where: { id: connector.id },
        create: {
          id: connector.id,
          name: connector.name,
          family: connector.family,
          accessMethod: connector.accessMethod,
          complianceNote: connector.notes,
          enabled: true,
          reviewedAt: this.now(),
        },
        update: {
          name: connector.name,
          family: connector.family,
          accessMethod: connector.accessMethod,
        },
      });
    }
    void requested;
  }

  private async updateSourceHealth(outcome: {
    source: string;
    status: string;
    error?: string | undefined;
  }): Promise<void> {
    const { db } = this.options;
    const existing = await db.jobSource.findUnique({ where: { id: outcome.source } });
    if (!existing) return;

    if (outcome.status === 'succeeded') {
      await db.jobSource.update({
        where: { id: outcome.source },
        data: {
          healthState: 'healthy',
          consecutiveFailures: 0,
          lastSuccessAt: this.now(),
          lastError: null,
        },
      });
      return;
    }
    if (outcome.status === 'failed') {
      const failures = existing.consecutiveFailures + 1;
      await db.jobSource.update({
        where: { id: outcome.source },
        data: {
          healthState: failures >= 3 ? 'failing' : 'degraded',
          consecutiveFailures: failures,
          lastFailureAt: this.now(),
          lastError: outcome.error?.slice(0, 300) ?? 'unknown error',
        },
      });
    }
  }

  private toSummary(
    run: {
      id: string;
      status: string;
      jobsFound: number;
      jobsNew: number;
      jobsUpdated: number;
      startedAt: Date;
      finishedAt: Date | null;
    },
    sourceRuns: Array<{
      sourceId: string;
      status: string;
      fetched: number;
      durationMs: number;
      error: string | null;
      note: string | null;
    }>,
  ): ScanSummary {
    return {
      scanRunId: run.id,
      status: run.status,
      jobsFound: run.jobsFound,
      jobsNew: run.jobsNew,
      jobsUpdated: run.jobsUpdated,
      sources: sourceRuns.map((sourceRun) => ({
        source: sourceRun.sourceId,
        status: sourceRun.status,
        fetched: sourceRun.fetched,
        durationMs: sourceRun.durationMs,
        ...(sourceRun.error ? { error: sourceRun.error } : {}),
        ...(sourceRun.note ? { note: sourceRun.note } : {}),
      })),
      startedAt: run.startedAt.toISOString(),
      ...(run.finishedAt ? { finishedAt: run.finishedAt.toISOString() } : {}),
    };
  }
}
