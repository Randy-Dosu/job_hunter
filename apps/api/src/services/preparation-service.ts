/**
 * Application preparation service.
 *
 * The product rule this module exists to honour:
 *
 *   Job Hunter may prepare an application package on the user's behalf.
 *   It never submits one. There is no submit method here, no `applied` write,
 *   and no column that could record a system submission.
 *
 * What "preparing" means concretely, for a job the user's preferences select:
 *   1. tailor the requested documents from *verified* facts only,
 *   2. attach them to an application record,
 *   3. compute what still needs a human, and park it in `ready_for_user`.
 *
 * The expensive, error-prone part (writing a truthful CV and letter per job) is
 * done for the user. The accountable part (sending it) is not delegated to us.
 *
 * Documents are never auto-*approved*: approval asserts "I read this and the
 * claims are true", which cannot be made on someone else's behalf. So a package
 * is assembled and checked, and the queue tells the user exactly what to confirm.
 */

import type { Database } from '../db/client.js';
import type { Logger } from '../lib/logger.js';
import type { DocumentKind } from '@job-hunter/shared-types';
import { DocumentService } from './document-service.js';
import type { AIGateway } from '@job-hunter/ai-gateway';
import { recordAudit } from '../lib/audit.js';

export interface PreparationServiceOptions {
  db: Database;
  logger: Logger;
  ai: AIGateway;
  now?: (() => Date) | undefined;
}

/** One job's outcome, reported to the caller rather than swallowed. */
export interface PreparationOutcome {
  jobId: string;
  status: 'prepared' | 'needs_review' | 'skipped' | 'failed';
  applicationId?: string;
  reason?: string;
  checklist?: string[];
}

export interface PreparationRunResult {
  prepared: number;
  skipped: number;
  failed: number;
  outcomes: PreparationOutcome[];
}

/** Guard rails: a first run must not try to prepare hundreds of packages. */
const MAX_JOBS_PER_RUN = 25;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

export class PreparationService {
  private readonly documents: DocumentService;

  constructor(private readonly options: PreparationServiceOptions) {
    this.documents = new DocumentService({
      db: options.db,
      logger: options.logger,
      ai: options.ai,
    });
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /**
   * Prepare packages for jobs that match the user's preferences.
   *
   * Selection is deliberately conservative: only jobs already scored at or above
   * the user's floor, never jobs they dismissed, never a job that already has an
   * application record.
   */
  async prepareForUser(input: {
    userId: string;
    trigger: 'manual' | 'scheduled';
  }): Promise<PreparationRunResult> {
    const { db } = this.options;

    const preferences = await db.jobPreferences.findUnique({ where: { userId: input.userId } });
    // Not enabled is not an error: the scheduler calls this for every user.
    if (!preferences?.autoPrepareEnabled) return empty();

    const remainingToday = await this.remainingQuota(input.userId);
    if (remainingToday <= 0) {
      this.options.logger.info('auto-prepare: daily limit reached', { userId: input.userId });
      return empty();
    }

    const jobIds = await this.selectJobs(input.userId, remainingToday);
    return this.prepareJobs({ userId: input.userId, jobIds });
  }

  /** How many more packages the user may have prepared today. */
  async remainingQuota(userId: string): Promise<number> {
    const { db } = this.options;
    const preferences = await db.jobPreferences.findUnique({ where: { userId } });
    if (!preferences) return 0;

    const since = new Date(this.now().getTime() - DAILY_WINDOW_MS);
    const preparedToday = await db.application.count({
      where: { userId, origin: 'auto_prepare', preparedAt: { gte: since } },
    });
    return Math.max(0, preferences.autoPrepareDailyLimit - preparedToday);
  }

  /** Jobs that qualify for automatic preparation right now. */
  async selectJobs(userId: string, limit: number): Promise<string[]> {
    const { db } = this.options;
    const preferences = await db.jobPreferences.findUnique({ where: { userId } });
    if (!preferences) return [];

    const matches = await db.jobMatch.findMany({
      where: {
        userId,
        score: { gte: preferences.autoPrepareMinScore },
        // A placeholder score (nothing verified) must never trigger real work,
        // even if a stored value happens to sit above the floor.
        scoreable: true,
        excluded: false,
      },
      orderBy: { score: 'desc' },
      take: MAX_JOBS_PER_RUN,
      select: { jobId: true, job: { select: { status: true } } },
    });

    const candidateIds = matches
      .filter((match) => match.job.status === 'active')
      .map((match) => match.jobId);
    if (candidateIds.length === 0) return [];

    const [states, existing] = await Promise.all([
      db.userJobState.findMany({
        where: { userId, jobId: { in: candidateIds } },
        select: { jobId: true, dismissed: true },
      }),
      db.application.findMany({
        where: { userId, jobId: { in: candidateIds } },
        select: { jobId: true },
      }),
    ]);

    const dismissed = new Set(
      states.filter((state) => state.dismissed).map((state) => state.jobId),
    );
    const alreadyHasRecord = new Set(existing.map((row) => row.jobId));

    return candidateIds
      .filter((jobId) => !dismissed.has(jobId) && !alreadyHasRecord.has(jobId))
      .slice(0, limit);
  }

  /**
   * Prepare packages for the given jobs. Idempotent per job: an existing
   * application record is left alone rather than duplicated or overwritten.
   */
  async prepareJobs(input: { userId: string; jobIds: string[] }): Promise<PreparationRunResult> {
    const { db } = this.options;
    const result: PreparationRunResult = empty();

    const preferences = await db.jobPreferences.findUnique({ where: { userId: input.userId } });
    const kinds = (preferences?.autoPrepareDocumentKinds ?? [
      'resume',
      'cover_letter',
    ]) as DocumentKind[];

    for (const jobId of input.jobIds) {
      try {
        const outcome = await this.prepareOne({ userId: input.userId, jobId, kinds });
        result.outcomes.push(outcome);
        if (outcome.status === 'failed') result.failed += 1;
        else if (outcome.status === 'skipped') result.skipped += 1;
        else result.prepared += 1;
      } catch (error) {
        // One bad job must not abort the batch.
        const reason = error instanceof Error ? error.message : 'Preparation failed';
        this.options.logger.warn('auto-prepare: job failed', { jobId, reason });
        result.outcomes.push({ jobId, status: 'failed', reason });
        result.failed += 1;
      }
    }

    await this.notify(input.userId, result);
    return result;
  }

  private async prepareOne(input: {
    userId: string;
    jobId: string;
    kinds: DocumentKind[];
  }): Promise<PreparationOutcome> {
    const { db } = this.options;

    const job = await db.job.findUnique({
      where: { id: input.jobId },
      select: { id: true, status: true },
    });
    if (!job) return { jobId: input.jobId, status: 'skipped', reason: 'Job not found' };
    if (job.status !== 'active') {
      return { jobId: input.jobId, status: 'skipped', reason: 'This listing is no longer active' };
    }

    const existing = await db.application.findUnique({
      where: { userId_jobId: { userId: input.userId, jobId: input.jobId } },
      select: { id: true },
    });
    if (existing) {
      return {
        jobId: input.jobId,
        status: 'skipped',
        reason: 'An application record already exists for this job',
      };
    }

    const verifiedCount = await db.profileFact.count({
      where: { userId: input.userId, verified: true },
    });
    if (verifiedCount === 0) {
      // Nothing may be invented, so there is nothing to prepare from.
      return {
        jobId: input.jobId,
        status: 'skipped',
        reason: 'No verified profile facts — documents would have nothing true to say',
      };
    }

    // Create the record first so a document-generation failure still leaves the
    // user with a visible, resumable entry rather than a silent gap.
    const application = await db.application.create({
      data: {
        userId: input.userId,
        jobId: input.jobId,
        status: 'preparing',
        origin: 'auto_prepare',
        preparedAt: this.now(),
        reviewChecklist: [],
      },
    });

    await db.applicationEvent.create({
      data: { applicationId: application.id, type: 'prepared_by_system', toStatus: 'preparing' },
    });

    const documentIds: Partial<Record<DocumentKind, string>> = {};
    const failures: string[] = [];

    for (const kind of input.kinds) {
      try {
        const generated = await this.documents.generateForJob({
          userId: input.userId,
          jobId: input.jobId,
          kind,
          tone: 'professional',
        });
        documentIds[kind] = generated.documentId;
      } catch (error) {
        failures.push(
          `${kind === 'resume' ? 'Resume' : 'Cover letter'} could not be prepared: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    const checklist = buildChecklist(failures);
    // Always `preparing`: the documents are drafts and need the user's approval
    // before the package can be send-ready. `accept()` is what moves it on. A
    // package that skipped this step would be claiming approval on the user's
    // behalf, which is exactly what this product refuses to do.
    const status = 'preparing';

    await db.application.update({
      where: { id: application.id },
      data: {
        status,
        resumeDocumentId: documentIds.resume ?? null,
        coverLetterDocumentId: documentIds.cover_letter ?? null,
        reviewChecklist: checklist,
      },
    });

    await db.applicationEvent.create({
      data: {
        applicationId: application.id,
        type: 'status_change',
        fromStatus: 'preparing',
        toStatus: status,
        message:
          checklist.length === 0
            ? 'Documents drafted from your verified facts — approve them to finish the package'
            : `${checklist.length} item${checklist.length === 1 ? '' : 's'} need your attention`,
      },
    });

    await recordAudit(db, this.options.logger, {
      userId: input.userId,
      action: 'application.prepared',
      entityType: 'application',
      entityId: application.id,
    });

    return {
      jobId: input.jobId,
      status: checklist.length === 0 ? 'prepared' : 'needs_review',
      applicationId: application.id,
      checklist,
    };
  }

  /** One notification summarising a batch, not one per job. */
  private async notify(userId: string, result: PreparationRunResult): Promise<void> {
    const { db } = this.options;
    const prepared = result.outcomes.filter(
      (outcome) => outcome.status === 'prepared' || outcome.status === 'needs_review',
    );
    if (prepared.length === 0) return;

    const firstJobId = prepared[0]?.jobId;
    if (!firstJobId) return;
    const job = await db.job.findUnique({
      where: { id: firstJobId },
      select: { title: true, company: true },
    });
    if (!job) return;

    const dedupeKey = `auto-prepare:${this.now().toISOString().slice(0, 10)}`;
    await db.notification.upsert({
      where: { userId_dedupeKey: { userId, dedupeKey } },
      create: {
        userId,
        kind: 'applications_prepared',
        title: `${prepared.length} application${prepared.length === 1 ? '' : 's'} prepared for you`,
        body: `Including ${job.title} at ${job.company}. Nothing has been sent — review and submit each one yourself.`,
        dedupeKey,
      },
      update: {},
    });
  }

  /**
   * Accept prepared packages.
   *
   * "Accept" means the user is satisfied with the package — not that they sent
   * it. There is no transition to `applied` here, and there never will be.
   */
  async accept(input: {
    userId: string;
    applicationIds: string[];
  }): Promise<{ accepted: number; skipped: Array<{ applicationId: string; reason: string }> }> {
    const { db } = this.options;
    const skipped: Array<{ applicationId: string; reason: string }> = [];
    let accepted = 0;

    for (const applicationId of input.applicationIds) {
      const application = await db.application.findFirst({
        where: { id: applicationId, userId: input.userId },
        select: {
          id: true,
          status: true,
          reviewChecklist: true,
          resumeDocumentId: true,
          coverLetterDocumentId: true,
        },
      });
      if (!application) {
        skipped.push({ applicationId, reason: 'Application not found' });
        continue;
      }
      if (application.reviewChecklist.length > 0) {
        skipped.push({ applicationId, reason: 'Clear the review checklist first' });
        continue;
      }
      if (application.status !== 'preparing' && application.status !== 'ready_for_user') {
        skipped.push({
          applicationId,
          reason: `Nothing to accept while status is ${application.status}`,
        });
        continue;
      }

      const documentIds = [application.resumeDocumentId, application.coverLetterDocumentId].filter(
        (value): value is string => typeof value === 'string',
      );

      // Batch approval still runs the evidence check on every document. Accepting
      // twenty packages at once must not mean twenty unchecked approvals.
      let blocked: string | undefined;
      for (const documentId of documentIds) {
        try {
          await this.documents.approve({
            userId: input.userId,
            documentId,
            acknowledgeWarnings: false,
          });
        } catch {
          blocked = 'A document contains claims that are not backed by your verified facts';
          break;
        }
      }

      if (blocked) {
        await db.application.update({
          where: { id: application.id },
          data: { status: 'preparing', reviewChecklist: [blocked] },
        });
        skipped.push({ applicationId, reason: blocked });
        continue;
      }

      await db.application.update({
        where: { id: application.id },
        data: { status: 'ready_for_user' },
      });
      await db.applicationEvent.create({
        data: {
          applicationId: application.id,
          type: 'status_change',
          fromStatus: application.status,
          toStatus: 'ready_for_user',
          message: 'You approved these documents — send the application yourself when ready',
        },
      });
      accepted += 1;
    }

    return { accepted, skipped };
  }

  /** Queue summary for the review screen. */
  async queue(userId: string): Promise<{
    items: Array<{
      applicationId: string;
      jobId: string;
      title: string;
      company: string;
      status: string;
      preparedAt: string | null;
      checklist: string[];
    }>;
    counts: { ready: number; needsReview: number };
  }> {
    const { db } = this.options;
    const rows = await db.application.findMany({
      where: {
        userId,
        origin: 'auto_prepare',
        archivedAt: null,
        status: { in: ['preparing', 'ready_for_user'] },
      },
      orderBy: [{ preparedAt: 'desc' }],
      take: 100,
      include: { job: { select: { id: true, title: true, company: true } } },
    });

    const items = rows.map((row) => ({
      applicationId: row.id,
      jobId: row.job.id,
      title: row.job.title,
      company: row.job.company,
      status: row.status,
      preparedAt: row.preparedAt?.toISOString() ?? null,
      checklist: row.reviewChecklist,
    }));

    return {
      items,
      counts: {
        ready: items.filter((item) => item.status === 'ready_for_user').length,
        needsReview: items.filter((item) => item.status === 'preparing').length,
      },
    };
  }
}

function empty(): PreparationRunResult {
  return { prepared: 0, skipped: 0, failed: 0, outcomes: [] };
}

/**
 * Why a package is not send-ready yet.
 *
 * Only *blockers* belong here — a failed generation, a document with unbacked
 * claims. "You must submit this yourself" is a standing property of the product,
 * not a per-package task, so it lives in the UI copy and the API note instead.
 * Mixing the two made every package permanently "needs you", which would train
 * users to ignore the checklist.
 */
function buildChecklist(failures: string[]): string[] {
  return failures;
}
