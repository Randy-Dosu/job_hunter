import type { FastifyInstance } from 'fastify';
import {
  startBrowserSessionSchema,
  fillBrowserFieldSchema,
  pauseBrowserSessionSchema,
  idParamSchema,
} from '@job-hunter/validation';
import type { ApprovedProfileData } from '@job-hunter/shared-types';
import type { AppContext } from '../app.js';
import { errors } from '../lib/errors.js';
import { requireUser } from './guards.js';
import { recordAudit } from '../lib/audit.js';
import {
  SITE_ALLOWLIST,
  buildSessionPlan,
  createSession,
  explainAllowlistDecision,
  isTerminal,
  isUrlAllowed,
  preflightSession,
  transition,
} from '@job-hunter/browser-agent';

export async function registerBrowserRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db, env } = context;
  const featureEnabled = env.FEATURE_BROWSER_ASSISTANT;

  /**
   * Every browser-assistance route answers the same way when the deployment has
   * the feature switched off. Checking it in one hook (rather than per handler,
   * and before any body parsing) keeps the message truthful: a disabled feature
   * is not a bad request.
   */
  const requireFeature = (): void => {
    if (!featureEnabled) {
      throw errors.featureDisabled('Browser assistance is switched off on this deployment.');
    }
  };

  /** Capability + compliance surface for the UI. */
  app.get('/browser-sessions/capabilities', async () => ({
    enabled: featureEnabled,
    allowlist: SITE_ALLOWLIST.filter((site) => site.enabled).map((site) => ({
      host: site.host,
      displayName: site.displayName,
      complianceNote: site.complianceNote,
    })),
    // The assistant never submits: this is a product guarantee, surfaced to users.
    guarantees: [
      'You must start every session yourself.',
      'Only allowlisted sites can be assisted.',
      'Only verified profile data and your saved answers are used.',
      'Legal, eligibility and demographic questions are never filled in.',
      'The assistant has no submit action — you review and submit yourself.',
    ],
  }));

  /**
   * Start a session. This does NOT open a browser: it validates consent and the
   * allowlist, then creates a plan for the user to review field by field.
   */
  app.post('/browser-sessions', async (request, reply) => {
    const user = requireUser(request);
    // Checked before the body: when the feature is off, the client is told so
    // rather than given a field-level validation error that implies it is merely
    // misconfigured.
    requireFeature();
    const input = startBrowserSessionSchema.parse(request.body);

    const job = await db.job.findUnique({
      where: { id: input.jobId },
      select: { id: true, url: true },
    });
    if (!job) throw errors.notFound('Job not found');

    const preflight = preflightSession(
      {
        sessionId: 'pending',
        jobId: job.id,
        applicationUrl: input.applicationUrl,
        consent: input.consent,
        profile: emptyApprovedProfile(),
      },
      { allowlist: SITE_ALLOWLIST, featureEnabled },
    );

    if (!preflight.ok) {
      const message =
        preflight.error.name === 'FeatureDisabledError'
          ? 'Browser assistance is switched off on this deployment.'
          : explainAllowlistDecision(isUrlAllowed(input.applicationUrl, SITE_ALLOWLIST) as never);
      throw preflight.error.name === 'FeatureDisabledError'
        ? errors.featureDisabled(message)
        : errors.forbidden(message);
    }

    const session = createSession({
      id: crypto.randomUUID(),
      userId: user.userId,
      jobId: job.id,
      applicationUrl: input.applicationUrl,
    });

    const stored = await db.browserSession.create({
      data: {
        id: session.id,
        userId: user.userId,
        jobId: job.id,
        applicationUrl: input.applicationUrl,
        adapterId: preflight.site.adapterId,
        status: session.status,
        expiresAt: new Date(session.expiresAt),
      },
    });

    await db.browserActionEvent.create({
      data: { sessionId: stored.id, action: 'session_started', detail: preflight.site.host },
    });
    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'browser_session.started',
      entityType: 'browser_session',
      entityId: stored.id,
    });

    return reply.status(201).send({
      session: toSessionDto(stored),
      // No fields are proposed until the caller supplies page markup; the UI
      // shows an explicit "nothing filled yet" state.
      plan: null,
    });
  });

  /** Map an actual application form's markup into proposed field values. */
  app.post<{ Params: { id: string } }>('/browser-sessions/:id/plan', async (request) => {
    const user = requireUser(request);
    requireFeature();
    const { id } = idParamSchema.parse(request.params);
    const session = await db.browserSession.findFirst({
      where: { id, userId: user.userId },
    });
    if (!session) throw errors.notFound('Session not found');
    if (isTerminal(session.status as never)) throw errors.conflict('This session has ended');
    if (session.status === 'expired' || session.expiresAt.getTime() <= Date.now()) {
      throw errors.conflict('This session has expired. Start a new one.');
    }

    const body = request.body as { html?: unknown } | undefined;
    const html = typeof body?.html === 'string' ? body.html.slice(0, 400_000) : '';

    const allowed = isUrlAllowed(session.applicationUrl, SITE_ALLOWLIST);
    if (!allowed.allowed) throw errors.forbidden('This site is no longer on the allowlist.');

    const profile = await buildApprovedProfile(user.userId);

    const plan = buildSessionPlan({
      sessionId: session.id,
      jobId: session.jobId,
      applicationUrl: session.applicationUrl,
      html,
      profile,
      adapterId: session.adapterId,
    });

    await db.browserSession.update({
      where: { id: session.id },
      data: {
        status: plan.status,
        pauseReason: plan.pauseReason ?? null,
      },
    });
    await db.browserActionEvent.create({
      data: {
        sessionId: session.id,
        action: plan.pauseReason === 'user_review' ? 'handed_off' : 'paused',
        detail: plan.pauseReason ?? 'user_review',
      },
    });

    // No values are written anywhere: this is a proposal for the user.
    return {
      plan,
      summary: {
        totalFields: plan.fields.length,
        prefilled: plan.fields.filter((field) => field.value !== null).length,
        needsYou: plan.fields.filter((field) => field.value === null).length,
        sensitive: plan.fields.filter((field) => field.sensitive).length,
      },
    };
  });

  app.post<{ Params: { id: string } }>('/browser-sessions/:id/fields', async (request) => {
    const user = requireUser(request);
    requireFeature();
    const input = fillBrowserFieldSchema.parse(request.body);
    const { id } = idParamSchema.parse(request.params);
    const session = await db.browserSession.findFirst({
      where: { id, userId: user.userId },
    });
    if (!session) throw errors.notFound('Session not found');

    // Saves the *user's* answer to their answer bank — never automates the page.
    const profile = await buildApprovedProfile(user.userId);
    const answers = { ...profile.answers, [input.fieldLabel]: input.value };
    await db.answerBankEntry.upsert({
      where: { userId: user.userId },
      create: { userId: user.userId, answers },
      update: { answers },
    });

    await db.browserActionEvent.create({
      data: {
        sessionId: session.id,
        action: 'field_filled',
        detail: input.fieldLabel.slice(0, 120),
      },
    });

    return { ok: true };
  });

  /** Explicit pause: the terminal handoff to the human. */
  app.post<{ Params: { id: string } }>('/browser-sessions/:id/pause', async (request) => {
    const user = requireUser(request);
    // Ownership is checked before the body is validated.
    requireFeature();
    const { id } = idParamSchema.parse(request.params);
    const session = await db.browserSession.findFirst({
      where: { id, userId: user.userId },
    });
    if (!session) throw errors.notFound('Session not found');
    const input = pauseBrowserSessionSchema.parse(request.body ?? { reason: 'user_review' });

    const state = createSession({
      id: session.id,
      userId: session.userId,
      jobId: session.jobId,
      applicationUrl: session.applicationUrl,
      now: new Date(session.createdAt),
    });

    const next = transition(
      { ...state, status: session.status as never, events: [] },
      'paused_for_user',
      { pauseReason: input.reason, actorId: user.userId },
    );

    const updated = await db.browserSession.update({
      where: { id: session.id },
      data: { status: next.status, pauseReason: next.pauseReason ?? null },
    });
    await db.browserActionEvent.create({
      data: { sessionId: session.id, action: 'paused', detail: input.reason },
    });
    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'browser_session.paused',
      entityType: 'browser_session',
      entityId: session.id,
    });

    return { session: toSessionDto(updated), note: input.note ?? null };
  });

  /** End a session (user finished applying or cancelled). */
  app.post<{ Params: { id: string } }>('/browser-sessions/:id/end', async (request) => {
    const user = requireUser(request);
    requireFeature();
    const { id } = idParamSchema.parse(request.params);
    const session = await db.browserSession.findFirst({
      where: { id, userId: user.userId },
    });
    if (!session) throw errors.notFound('Session not found');

    const updated = await db.browserSession.update({
      where: { id: session.id },
      data: { status: 'completed', endedAt: new Date() },
    });
    await db.browserActionEvent.create({
      data: { sessionId: session.id, action: 'session_ended' },
    });
    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'browser_session.ended',
      entityType: 'browser_session',
      entityId: session.id,
    });
    return { session: toSessionDto(updated) };
  });

  app.get('/browser-sessions', async (request) => {
    const user = requireUser(request);
    const sessions = await db.browserSession.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { events: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    return {
      sessions: sessions.map((session) => ({
        ...toSessionDto(session),
        events: session.events.map((event) => ({
          action: event.action,
          detail: event.detail,
          createdAt: event.createdAt.toISOString(),
        })),
      })),
    };
  });

  async function buildApprovedProfile(userId: string): Promise<ApprovedProfileData> {
    const [profile, facts, answers] = await Promise.all([
      db.candidateProfile.findUnique({ where: { userId } }),
      db.profileFact.findMany({ where: { userId, verified: true } }),
      db.answerBankEntry.findUnique({ where: { userId } }),
    ]);

    const content = profile?.content as {
      contact?: {
        fullName?: string;
        email?: string;
        phone?: string;
        location?: string;
        website?: string;
        linkedin?: string;
        github?: string;
      };
      headline?: string;
      summary?: string;
      skills?: string[];
    } | null;

    const contact = content?.contact ?? {};
    const mostRecentRole = facts.find((fact) => fact.kind === 'experience');

    return {
      contact: {
        fullName: contact.fullName ?? '',
        ...(contact.fullName ? { firstName: contact.fullName.split(' ')[0] } : {}),
        ...(contact.fullName && contact.fullName.includes(' ')
          ? { lastName: contact.fullName.split(' ').slice(1).join(' ') }
          : {}),
        email: contact.email ?? '',
        ...(contact.phone ? { phone: contact.phone } : {}),
        ...(contact.location ? { location: contact.location } : {}),
        ...(contact.website ? { website: contact.website } : {}),
        ...(contact.linkedin ? { linkedin: contact.linkedin } : {}),
        ...(contact.github ? { github: contact.github } : {}),
      },
      ...(content?.headline ? { headline: content.headline } : {}),
      ...(content?.summary ? { summary: content.summary } : {}),
      skills: content?.skills ?? [],
      ...(mostRecentRole
        ? {
            mostRecentRole: {
              title: mostRecentRole.role ?? mostRecentRole.label,
              company: mostRecentRole.organisation ?? '',
            },
          }
        : {}),
      answers: (answers?.answers as Record<string, string> | null) ?? {},
    };
  }
}

function emptyApprovedProfile(): ApprovedProfileData {
  return { contact: { fullName: '', email: '' }, skills: [], answers: {} };
}

function toSessionDto(session: {
  id: string;
  jobId: string;
  applicationUrl: string;
  adapterId: string;
  status: string;
  pauseReason: string | null;
  expiresAt: Date;
  endedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: session.id,
    jobId: session.jobId,
    applicationUrl: session.applicationUrl,
    adapterId: session.adapterId,
    status: session.status,
    pauseReason: session.pauseReason,
    expiresAt: session.expiresAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
  };
}
