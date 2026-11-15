import type { FastifyInstance } from 'fastify';
import {
  jobIdParamSchema,
  jobListQuerySchema,
  jobStateSchema,
  jobFeedbackSchema,
} from '@job-hunter/validation';
import type { MatchGap, MatchEvidence, ScoreComponent } from '@job-hunter/shared-types';
import type { AppContext } from '../app.js';
import { errors } from '../lib/errors.js';
import { requireUser } from './guards.js';
import { toJobPreferences } from '../services/auth-service.js';
import { scoreJob, explainMatch, splitGaps, summarizeMatch } from '@job-hunter/matching';
import { toFactDto } from './profile.js';

export async function registerJobRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  const { db } = context;

  app.get('/jobs', async (request) => {
    const user = requireUser(request);
    const query = jobListQuerySchema.parse(request.query);

    const where: Record<string, unknown> = { status: 'active' };
    if (query.sources && query.sources.length > 0) where.source = { in: query.sources };
    if (query.remote === true) where.remote = true;
    if (query.countryCode) where.countryCode = query.countryCode.toUpperCase();
    if (query.employmentType) where.employmentType = query.employmentType;
    if (query.seniority) where.seniority = query.seniority;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { company: { contains: query.search, mode: 'insensitive' } },
        { tags: { has: query.search } },
      ];
    }

    // Score filtering and hiding dismissed jobs both need the per-user state.
    const states = await db.userJobState.findMany({ where: { userId: user.userId } });
    const dismissedIds = new Set(
      states.filter((state) => state.dismissed).map((state) => state.jobId),
    );
    const savedIds = new Set(states.filter((state) => state.saved).map((state) => state.jobId));
    // These two conditions both target `where.id`, so they must be combined
    // rather than assigned: assigning `saved` last replaced the dismissed
    // exclusion entirely and a dismissed job reappeared under "Saved only".
    if (query.saved === true) {
      where.id = {
        in: [...savedIds].filter((id) => query.dismissed === true || !dismissedIds.has(id)),
      };
    } else if (query.dismissed === true) {
      where.id = { in: [...dismissedIds] };
    } else {
      where.id = { notIn: [...dismissedIds] };
    }

    const matches = await db.jobMatch.findMany({
      where: { userId: user.userId },
      select: {
        jobId: true,
        score: true,
        band: true,
        scoreable: true,
        components: true,
        gaps: true,
      },
    });
    const matchByJob = new Map(matches.map((match) => [match.jobId, match]));

    if (query.minScore !== undefined) {
      const allowed = matches
        .filter((match) => match.score >= query.minScore!)
        .map((match) => match.jobId);
      const currentNotIn = (where.id as { notIn?: string[] } | undefined)?.notIn ?? [];
      const currentIn = (where.id as { in?: string[] } | undefined)?.in;
      const intersection = currentIn ? currentIn.filter((id) => allowed.includes(id)) : allowed;
      where.id = { in: intersection.filter((id) => !currentNotIn.includes(id)) };
    }

    const [total, jobs] = await Promise.all([
      db.job.count({ where }),
      db.job.findMany({
        where,
        orderBy: query.sort === 'company' ? [{ company: 'asc' }] : [{ firstSeenAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { records: true },
      }),
    ]);

    let items = jobs.map((job) => {
      const match = matchByJob.get(job.id);
      return {
        id: job.id,
        title: job.title,
        company: job.company,
        companyLogoUrl: job.companyLogoUrl,
        url: job.url,
        source: job.source,
        sources: [...new Set(job.records.map((record) => record.sourceId))],
        location: {
          raw: job.locationRaw,
          countryCode: job.countryCode,
          remote: job.remote,
          workplace: job.workplace,
        },
        employmentType: job.employmentType,
        seniority: job.seniority,
        salary:
          job.salaryMin || job.salaryMax
            ? {
                min: job.salaryMin,
                max: job.salaryMax,
                currency: job.salaryCurrency,
                period: job.salaryPeriod,
              }
            : null,
        tags: job.tags,
        freshness: job.freshness,
        postedAt: job.postedAt?.toISOString() ?? null,
        firstSeenAt: job.firstSeenAt.toISOString(),
        match: match
          ? {
              score: match.score,
              band: match.band,
              scoreable: match.scoreable,
              // `scoreable` must be part of the input: the summary uses it to
              // avoid describing gaps for a profile with no evidence at all.
              summary: summarizeMatch({
                scoreable: match.scoreable,
                components: match.components as unknown as ScoreComponent[],
                gaps: match.gaps as unknown as MatchGap[],
              } as never),
            }
          : null,
        saved: savedIds.has(job.id),
        dismissed: dismissedIds.has(job.id),
      };
    });

    if (query.sort === 'score') {
      items = items.sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1));
    }

    return { items, total, page: query.page, pageSize: query.pageSize };
  });

  app.get<{ Params: { jobId: string } }>('/jobs/:jobId', async (request) => {
    const user = requireUser(request);
    const { jobId } = jobIdParamSchema.parse(request.params);
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: { records: true },
    });
    if (!job) throw errors.notFound('Job not found');

    const [match, state, application] = await Promise.all([
      db.jobMatch.findUnique({ where: { userId_jobId: { userId: user.userId, jobId: job.id } } }),
      db.userJobState.findUnique({
        where: { userId_jobId: { userId: user.userId, jobId: job.id } },
      }),
      db.application.findUnique({
        where: { userId_jobId: { userId: user.userId, jobId: job.id } },
      }),
    ]);

    if (state?.viewedAt === null || state === null) {
      await db.userJobState.upsert({
        where: { userId_jobId: { userId: user.userId, jobId: job.id } },
        create: { userId: user.userId, jobId: job.id, viewedAt: new Date() },
        update: { viewedAt: new Date() },
      });
    }

    const documents = await db.generatedDocument.findMany({
      where: { userId: user.userId, jobId: job.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        version: true,
        status: true,
        createdAt: true,
        warnings: true,
      },
    });

    return {
      job: {
        id: job.id,
        title: job.title,
        company: job.company,
        companyLogoUrl: job.companyLogoUrl,
        description: job.description,
        url: job.url,
        source: job.source,
        sources: [...new Set(job.records.map((record) => record.sourceId))],
        location: {
          raw: job.locationRaw,
          countryCode: job.countryCode,
          remote: job.remote,
          workplace: job.workplace,
        },
        employmentType: job.employmentType,
        seniority: job.seniority,
        salary:
          job.salaryMin || job.salaryMax
            ? {
                min: job.salaryMin,
                max: job.salaryMax,
                currency: job.salaryCurrency,
                period: job.salaryPeriod,
              }
            : null,
        tags: job.tags,
        freshness: job.freshness,
        postedAt: job.postedAt?.toISOString() ?? null,
        firstSeenAt: job.firstSeenAt.toISOString(),
        lastCheckedAt: job.lastCheckedAt.toISOString(),
      },
      match: match ? buildMatchResponse(match) : null,
      state: {
        saved: state?.saved ?? false,
        dismissed: state?.dismissed ?? false,
        feedback: state?.feedback ?? null,
      },
      application: application ? { id: application.id, status: application.status } : null,
      documents: documents.map((document) => ({
        ...document,
        createdAt: document.createdAt.toISOString(),
      })),
    };
  });

  /** Recompute the compatibility match on demand (uses verified facts only). */
  app.post<{ Params: { jobId: string } }>('/jobs/:jobId/match', async (request) => {
    const user = requireUser(request);
    const { jobId } = jobIdParamSchema.parse(request.params);
    const job = await db.job.findUnique({ where: { id: jobId } });
    if (!job) throw errors.notFound('Job not found');

    const [profile, facts, prefsRow] = await Promise.all([
      db.candidateProfile.findUnique({ where: { userId: user.userId } }),
      db.profileFact.findMany({ where: { userId: user.userId, verified: true } }),
      db.jobPreferences.findUnique({ where: { userId: user.userId } }),
    ]);
    if (!profile) throw errors.notFound('Complete your profile first');

    const preferences = prefsRow
      ? toJobPreferences(prefsRow)
      : {
          targetTitles: [],
          targetKeywords: [],
          excludedKeywords: [],
          excludedCompanies: [],
          locations: [],
          countryCodes: [],
          remoteOnly: false,
          workplaceTypes: [],
          employmentTypes: [],
          seniorityLevels: [],
          enabledSources: [],
          timeZone: 'UTC',
          scanHourLocal: 8,
        };

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
      profile: profile.content as never,
      verifiedFacts: facts.map(toFactDto),
      preferences,
    });

    const saved = await db.jobMatch.upsert({
      where: { userId_jobId: { userId: user.userId, jobId: job.id } },
      create: {
        userId: user.userId,
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
        computedAt: new Date(),
      },
    });

    return { match: buildMatchResponse(saved) };
  });

  app.put<{ Params: { jobId: string } }>('/jobs/:jobId/state', async (request, reply) => {
    const user = requireUser(request);
    const input = jobStateSchema.parse(request.body);
    const { jobId } = jobIdParamSchema.parse(request.params);

    const job = await db.job.findUnique({
      where: { id: jobId },
      select: { id: true },
    });
    if (!job) throw errors.notFound('Job not found');

    const state = await db.userJobState.upsert({
      where: { userId_jobId: { userId: user.userId, jobId: job.id } },
      create: {
        userId: user.userId,
        jobId: job.id,
        saved: input.saved ?? false,
        dismissed: input.dismissed ?? false,
        feedback: input.feedback ?? null,
      },
      update: {
        ...(input.saved !== undefined ? { saved: input.saved } : {}),
        ...(input.dismissed !== undefined ? { dismissed: input.dismissed } : {}),
        ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
      },
    });

    if (input.feedback !== undefined) {
      await db.jobMatch.updateMany({
        where: { userId: user.userId, jobId: job.id },
        data: { userFeedback: input.feedback },
      });
    }

    return reply.send({
      state: { saved: state.saved, dismissed: state.dismissed, feedback: state.feedback },
    });
  });

  /** Relevance feedback used to tune future matching. */
  app.post<{ Params: { jobId: string } }>('/jobs/:jobId/feedback', async (request, reply) => {
    const user = requireUser(request);
    const input = jobFeedbackSchema.parse(request.body);
    const { jobId } = jobIdParamSchema.parse(request.params);
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: { id: true },
    });
    if (!job) throw errors.notFound('Job not found');

    await db.jobMatch.updateMany({
      where: { userId: user.userId, jobId: job.id },
      data: { userFeedback: input.relevance },
    });
    return reply.status(201).send({ ok: true });
  });
}

function buildMatchResponse(match: {
  score: number;
  band: string;
  scoreable: boolean;
  components: unknown;
  evidence: unknown;
  gaps: unknown;
  scoringVersion: string;
  profileVersion: string;
  usedSemantic: boolean;
  computedAt: Date;
  excluded: boolean;
  exclusionReason: string | null;
}) {
  const components = match.components as ScoreComponent[];
  const gaps = match.gaps as MatchGap[];
  const evidence = match.evidence as MatchEvidence[];
  const { confirmed, unknown } = splitGaps(gaps);

  return {
    score: match.score,
    band: match.band,
    scoringVersion: match.scoringVersion,
    profileVersion: match.profileVersion,
    scoreable: match.scoreable,
    usedSemantic: match.usedSemantic,
    computedAt: match.computedAt.toISOString(),
    excluded: match.excluded,
    exclusionReason: match.exclusionReason,
    breakdown: explainMatch({
      components,
      gaps,
      evidence,
      score: match.score,
    } as never),
    evidence: evidence.slice(0, 30),
    gaps: confirmed,
    unknowns: unknown,
  };
}
