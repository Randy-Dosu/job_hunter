import type { FastifyInstance } from 'fastify';
import {
  applicationListQuerySchema,
  createApplicationSchema,
  updateApplicationSchema,
  addApplicationNoteSchema,
} from '@job-hunter/validation';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_TRANSITIONS,
  APPLICATION_STATUS_LABELS,
  type ApplicationStatus,
} from '@job-hunter/shared-types';
import type { AppContext } from '../app.js';
import { errors } from '../lib/errors.js';
import { requireUser } from './guards.js';
import { recordAudit } from '../lib/audit.js';

export async function registerApplicationRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db } = context;

  async function loadApplication(userId: string, id: string) {
    const application = await db.application.findFirst({
      where: { id, userId },
      include: { job: true, events: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!application) throw errors.notFound('Application not found');
    return application;
  }

  app.get('/applications', async (request) => {
    const user = requireUser(request);
    const query = applicationListQuerySchema.parse(request.query);

    const [total, applications] = await Promise.all([
      db.application.count({ where: { userId: user.userId, archivedAt: null } }),
      db.application.findMany({
        where: {
          userId: user.userId,
          archivedAt: null,
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: [{ updatedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          job: {
            select: {
              id: true,
              title: true,
              company: true,
              url: true,
              source: true,
              locationRaw: true,
            },
          },
          events: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
    ]);

    const counts = await db.application.groupBy({
      by: ['status'],
      where: { userId: user.userId, archivedAt: null },
      _count: { _all: true },
    });

    return {
      items: applications.map((application) => ({
        id: application.id,
        status: application.status,
        statusLabel:
          APPLICATION_STATUS_LABELS[application.status as ApplicationStatus] ?? application.status,
        notes: application.notes,
        nextActionAt: application.nextActionAt?.toISOString() ?? null,
        appliedAt: application.appliedAt?.toISOString() ?? null,
        createdAt: application.createdAt.toISOString(),
        updatedAt: application.updatedAt.toISOString(),
        resumeDocumentId: application.resumeDocumentId,
        coverLetterDocumentId: application.coverLetterDocumentId,
        job: application.job,
        lastEvent: application.events[0]
          ? {
              type: application.events[0].type,
              message: application.events[0].message,
              createdAt: application.events[0].createdAt.toISOString(),
            }
          : null,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
      statuses: APPLICATION_STATUSES.map((status) => ({
        value: status,
        label: APPLICATION_STATUS_LABELS[status],
      })),
    };
  });

  app.post('/applications', async (request, reply) => {
    const user = requireUser(request);
    const input = createApplicationSchema.parse(request.body);

    const job = await db.job.findUnique({ where: { id: input.jobId }, select: { id: true } });
    if (!job) throw errors.notFound('Job not found');

    const existing = await db.application.findUnique({
      where: { userId_jobId: { userId: user.userId, jobId: job.id } },
    });
    if (existing) throw errors.conflict('You already have an application record for this job');

    // Only approved documents may be attached to an application package.
    for (const documentId of [input.resumeDocumentId, input.coverLetterDocumentId]) {
      if (!documentId) continue;
      const document = await db.generatedDocument.findFirst({
        where: { id: documentId, userId: user.userId, jobId: job.id },
      });
      if (!document) throw errors.validation('That document does not belong to this job');
      if (document.status !== 'approved') {
        throw errors.conflict('Approve the document before attaching it to an application');
      }
    }

    const application = await db.application.create({
      data: {
        userId: user.userId,
        jobId: job.id,
        status: input.status,
        resumeDocumentId: input.resumeDocumentId ?? null,
        coverLetterDocumentId: input.coverLetterDocumentId ?? null,
        notes: input.notes ?? null,
        nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null,
        appliedAt: input.status === 'applied' ? new Date() : null,
      },
    });

    await db.applicationEvent.create({
      data: { applicationId: application.id, type: 'created', toStatus: application.status },
    });
    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'application.created',
      entityType: 'application',
      entityId: application.id,
    });

    return reply.status(201).send({
      application: { id: application.id, status: application.status },
    });
  });

  app.get<{ Params: { id: string } }>('/applications/:id', async (request) => {
    const user = requireUser(request);
    const application = await loadApplication(user.userId, request.params.id);

    const documentIds = [application.resumeDocumentId, application.coverLetterDocumentId].filter(
      (value): value is string => typeof value === 'string',
    );
    const documents = documentIds.length
      ? await db.generatedDocument.findMany({
          where: { id: { in: documentIds }, userId: user.userId },
          select: { id: true, kind: true, version: true, status: true },
        })
      : [];

    return {
      application: {
        id: application.id,
        status: application.status,
        statusLabel:
          APPLICATION_STATUS_LABELS[application.status as ApplicationStatus] ?? application.status,
        notes: application.notes,
        nextActionAt: application.nextActionAt?.toISOString() ?? null,
        appliedAt: application.appliedAt?.toISOString() ?? null,
        createdAt: application.createdAt.toISOString(),
        updatedAt: application.updatedAt.toISOString(),
        job: {
          id: application.job.id,
          title: application.job.title,
          company: application.job.company,
          url: application.job.url,
          source: application.job.source,
          locationRaw: application.job.locationRaw,
        },
        documents,
        allowedTransitions:
          APPLICATION_STATUS_TRANSITIONS[application.status as ApplicationStatus] ?? [],
        events: application.events.map((event) => ({
          id: event.id,
          type: event.type,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          message: event.message,
          createdAt: event.createdAt.toISOString(),
        })),
      },
    };
  });

  app.patch<{ Params: { id: string } }>('/applications/:id', async (request) => {
    const user = requireUser(request);
    // Ownership is checked before the body is validated.
    const application = await loadApplication(user.userId, request.params.id);
    const input = updateApplicationSchema.parse(request.body ?? {});

    if (input.status && input.status !== application.status) {
      const allowed = APPLICATION_STATUS_TRANSITIONS[application.status as ApplicationStatus] ?? [];
      if (!allowed.includes(input.status)) {
        throw errors.conflict(
          `You cannot move an application from "${application.status}" to "${input.status}".`,
        );
      }
    }

    const updated = await db.application.update({
      where: { id: application.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.nextActionAt !== undefined
          ? { nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null }
          : {}),
        ...(input.resumeDocumentId !== undefined
          ? { resumeDocumentId: input.resumeDocumentId }
          : {}),
        ...(input.coverLetterDocumentId !== undefined
          ? { coverLetterDocumentId: input.coverLetterDocumentId }
          : {}),
        ...(input.status === 'applied' && !application.appliedAt ? { appliedAt: new Date() } : {}),
      },
    });

    if (input.status && input.status !== application.status) {
      await db.applicationEvent.create({
        data: {
          applicationId: application.id,
          type: 'status_change',
          fromStatus: application.status,
          toStatus: input.status,
          message: `Status changed to ${APPLICATION_STATUS_LABELS[input.status]}`,
        },
      });
      await recordAudit(db, context.logger, {
        userId: user.userId,
        action: 'application.status_changed',
        entityType: 'application',
        entityId: application.id,
      });
    }

    return {
      application: {
        id: updated.id,
        status: updated.status,
        updatedAt: updated.updatedAt.toISOString(),
      },
    };
  });

  app.post<{ Params: { id: string } }>('/applications/:id/notes', async (request, reply) => {
    const user = requireUser(request);
    // Ownership is checked before the body is validated.
    const application = await loadApplication(user.userId, request.params.id);
    const input = addApplicationNoteSchema.parse(request.body ?? {});

    const event = await db.applicationEvent.create({
      data: { applicationId: application.id, type: 'note', message: input.message },
    });
    return reply.status(201).send({
      event: {
        id: event.id,
        type: event.type,
        message: event.message,
        createdAt: event.createdAt.toISOString(),
      },
    });
  });

  app.delete<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
    const user = requireUser(request);
    const application = await loadApplication(user.userId, request.params.id);
    await db.application.update({
      where: { id: application.id },
      data: { archivedAt: new Date() },
    });
    return reply.status(204).send();
  });
}
