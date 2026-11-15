import type { FastifyInstance } from 'fastify';
import { idParamSchema } from '@job-hunter/validation';
import { MAX_RESUME_BYTES, validateResumeFile } from '@job-hunter/resume-parser';
import { extractResumeText } from '@job-hunter/resume-parser';
import { parseResumeText } from '@job-hunter/resume-parser';
import { LIMITS } from '@job-hunter/config';
import type { AppContext } from '../app.js';
import { errors } from '../lib/errors.js';
import { requireUser } from './guards.js';
import { recordAudit } from '../lib/audit.js';
import { toFactDto } from './profile.js';

export async function registerResumeRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db, storage } = context;

  app.get('/resumes', async (request) => {
    const user = requireUser(request);
    const resumes = await db.resume.findMany({
      where: { userId: user.userId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        parseStatus: true,
        parseError: true,
        isPrimary: true,
        createdAt: true,
      },
    });
    return {
      resumes: resumes.map((resume) => ({
        ...resume,
        uploadedAt: resume.createdAt.toISOString(),
        createdAt: undefined,
      })),
    };
  });

  app.post('/resumes', async (request, reply) => {
    const user = requireUser(request);

    const limit = context.rateLimiters.upload.check(`resume:${user.userId}`);
    if (!limit.allowed) throw errors.rateLimited('Too many uploads. Try again later.');

    const existingCount = await db.resume.count({
      where: { userId: user.userId, deletedAt: null },
    });
    if (existingCount >= LIMITS.maxResumesPerUser) {
      throw errors.validation(
        `You can keep up to ${LIMITS.maxResumesPerUser} resumes. Delete one first.`,
      );
    }

    const file = await request.file();
    if (!file) throw errors.validation('Attach a PDF, DOCX or TXT file');

    const buffer = await file.toBuffer();
    if (buffer.length > MAX_RESUME_BYTES)
      throw errors.payloadTooLarge('Resumes must be 5 MB or smaller');

    const validation = validateResumeFile({
      fileName: file.filename,
      mimeType: file.mimetype,
      sizeBytes: buffer.length,
      buffer,
    });
    if (!validation.ok) {
      throw validation.reason?.includes('larger')
        ? errors.payloadTooLarge(validation.reason)
        : errors.unsupportedMedia(validation.reason ?? 'Unsupported file');
    }

    const stored = await storage.put({
      userId: user.userId,
      fileName: file.filename,
      buffer,
      contentType: file.mimetype,
    });

    const isFirst = existingCount === 0;
    const resume = await db.resume.create({
      data: {
        userId: user.userId,
        fileName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: buffer.length,
        storageKey: stored.key,
        checksum: stored.checksum,
        parseStatus: 'pending',
        isPrimary: isFirst,
      },
    });

    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'resume.uploaded',
      entityType: 'resume',
      entityId: resume.id,
    });

    return reply.status(201).send({
      resume: {
        id: resume.id,
        fileName: resume.fileName,
        mimeType: resume.mimeType,
        sizeBytes: resume.sizeBytes,
        parseStatus: resume.parseStatus,
        isPrimary: resume.isPrimary,
        uploadedAt: resume.createdAt.toISOString(),
      },
    });
  });

  /**
   * Parse an uploaded resume into candidate facts.
   *
   * Facts are created with `verified: false`. The client shows them for review;
   * nothing extracted here can be used as evidence until the user confirms it.
   */
  app.post<{ Params: { id: string } }>('/resumes/:id/parse', async (request) => {
    const user = requireUser(request);
    const { id } = idParamSchema.parse(request.params);
    const resume = await db.resume.findFirst({
      where: { id: id, userId: user.userId, deletedAt: null },
    });
    if (!resume) throw errors.notFound('Resume not found');

    await db.resume.update({
      where: { id: resume.id },
      data: { parseStatus: 'parsing', parseError: null },
    });

    try {
      const buffer = await storage.get(resume.storageKey);
      const extraction = await extractResumeText({
        buffer,
        fileName: resume.fileName,
        mimeType: resume.mimeType,
      });

      const profile = await db.candidateProfile.findUnique({ where: { userId: user.userId } });
      const contact = (
        profile?.content as { contact?: { fullName?: string; email?: string } } | null
      )?.contact;

      const parsed = parseResumeText(extraction.text, {
        ...(contact?.fullName ? { fallbackName: contact.fullName } : {}),
        ...(contact?.email ? { fallbackEmail: contact.email } : {}),
      });

      // Replace any previous unverified facts from this resume, keep verified ones
      // (the user's confirmed data must survive a re-parse).
      await db.profileFact.deleteMany({
        where: { resumeId: resume.id, userId: user.userId, verified: false },
      });

      const created = await db.$transaction(
        parsed.facts.slice(0, 300).map((fact) =>
          db.profileFact.create({
            data: {
              userId: user.userId,
              resumeId: resume.id,
              kind: fact.kind,
              label: fact.label.slice(0, 300),
              detail: fact.detail ?? null,
              keywords: fact.keywords.slice(0, 40),
              startDate: fact.startDate ?? null,
              endDate: fact.endDate ?? null,
              organisation: fact.organisation ?? null,
              role: fact.role ?? null,
              source: 'resume_parse',
              verified: false,
              evidenceRef: fact.evidenceRef ?? null,
            },
          }),
        ),
      );

      await db.resume.update({
        where: { id: resume.id },
        data: { parseStatus: 'parsed', parsedAt: new Date(), parseError: null },
      });

      await recordAudit(db, context.logger, {
        userId: user.userId,
        action: 'resume.parsed',
        entityType: 'resume',
        entityId: resume.id,
      });

      return {
        parseStatus: 'parsed' as const,
        warnings: [
          ...extraction.warnings,
          ...parsed.warnings,
          ...(created.length === 0
            ? ['No facts were extracted. You can add your details manually in the profile screen.']
            : []),
        ],
        extracted: parsed.content,
        facts: created.map(toFactDto),
        stats: {
          pages: extraction.pageCount,
          characters: parsed.textLength,
          facts: created.length,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The resume could not be read';
      await db.resume.update({
        where: { id: resume.id },
        data: { parseStatus: 'failed', parseError: message.slice(0, 500) },
      });
      throw errors.validation(message);
    }
  });

  app.delete<{ Params: { id: string } }>('/resumes/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = idParamSchema.parse(request.params);
    const resume = await db.resume.findFirst({
      where: { id: id, userId: user.userId, deletedAt: null },
    });
    if (!resume) throw errors.notFound('Resume not found');

    // Soft-delete the record, remove the bytes immediately.
    await db.resume.update({ where: { id: resume.id }, data: { deletedAt: new Date() } });
    await storage.delete(resume.storageKey);
    await db.profileFact.deleteMany({ where: { resumeId: resume.id, verified: false } });

    if (resume.isPrimary) {
      const next = await db.resume.findFirst({
        where: { userId: user.userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (next) await db.resume.update({ where: { id: next.id }, data: { isPrimary: true } });
    }

    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'resume.deleted',
      entityType: 'resume',
      entityId: resume.id,
    });
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/resumes/:id/primary', async (request) => {
    const user = requireUser(request);
    const { id } = idParamSchema.parse(request.params);
    const resume = await db.resume.findFirst({
      where: { id: id, userId: user.userId, deletedAt: null },
    });
    if (!resume) throw errors.notFound('Resume not found');

    await db.$transaction([
      db.resume.updateMany({ where: { userId: user.userId }, data: { isPrimary: false } }),
      db.resume.update({ where: { id: resume.id }, data: { isPrimary: true } }),
    ]);
    return { ok: true };
  });
}
