import type { FastifyInstance } from 'fastify';
import {
  approveDocumentSchema,
  editDocumentSchema,
  exportDocumentSchema,
  generateDocumentSchema,
} from '@job-hunter/validation';
import type { GeneratedDocumentContent } from '@job-hunter/shared-types';
import type { AppContext } from '../app.js';
import { errors } from '../lib/errors.js';
import { requireUser } from './guards.js';
import { DocumentService } from '../services/document-service.js';
import { recordAudit } from '../lib/audit.js';
import { exportDocument, lintAts, toPlainText } from '@job-hunter/document-engine';
import { checkEvidence, countWords } from '@job-hunter/document-engine';
import { toFactDto } from './profile.js';

export async function registerDocumentRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db } = context;
  const service = new DocumentService({ db, logger: context.logger, ai: context.ai });

  async function loadDocument(userId: string, id: string) {
    const document = await db.generatedDocument.findFirst({ where: { id, userId } });
    if (!document) throw errors.notFound('Document not found');
    return document;
  }

  async function exportInput(userId: string, document: { content: unknown; kind: string }) {
    const profile = await db.candidateProfile.findUnique({ where: { userId } });
    const contact =
      (profile?.content as { contact?: Record<string, string> } | null)?.contact ?? {};
    return {
      document: document.content as unknown as GeneratedDocumentContent,
      contact: {
        fullName: contact.fullName ?? 'Candidate',
        email: contact.email ?? '',
        ...(contact.phone ? { phone: contact.phone } : {}),
        ...(contact.location ? { location: contact.location } : {}),
        ...(contact.website ? { website: contact.website } : {}),
        ...(contact.linkedin ? { linkedin: contact.linkedin } : {}),
      },
    };
  }

  /** Generate a tailored resume or cover letter for a job (stored as a draft). */
  app.post<{ Params: { jobId: string } }>('/jobs/:jobId/documents', async (request, reply) => {
    const user = requireUser(request);
    const input = generateDocumentSchema.parse(request.body ?? {});

    const limit = context.rateLimiters.ai.check(`ai:${user.userId}`);
    if (!limit.allowed) {
      throw errors.rateLimited(
        `You can generate ${context.env.RATE_LIMIT_AI_PER_HOUR} documents per hour.`,
      );
    }

    const result = await service.generateForJob({
      userId: user.userId,
      jobId: request.params.jobId,
      kind: input.kind,
      tone: input.tone,
    });

    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'document.generated',
      entityType: 'generated_document',
      entityId: result.documentId,
    });

    const document = await loadDocument(user.userId, result.documentId);
    return reply.status(201).send({ document: toDocumentDto(document) });
  });

  app.get('/documents', async (request) => {
    const user = requireUser(request);
    const query = request.query as { jobId?: string; kind?: string };
    const documents = await db.generatedDocument.findMany({
      where: {
        userId: user.userId,
        ...(query.jobId ? { jobId: query.jobId } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { job: { select: { title: true, company: true } } },
    });
    return {
      documents: documents.map((document) => ({
        ...toDocumentDto(document),
        job: document.job,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/documents/:id', async (request) => {
    const user = requireUser(request);
    const document = await loadDocument(user.userId, request.params.id);
    const job = await db.job.findUnique({
      where: { id: document.jobId },
      select: { title: true, company: true, url: true },
    });

    const exportPayload = await exportInput(user.userId, document);
    return {
      document: toDocumentDto(document),
      job,
      plainText: toPlainText(exportPayload),
      atsIssues: lintAts(exportPayload),
    };
  });

  /** Save user edits. Edits are re-checked for unsupported claims. */
  app.patch<{ Params: { id: string } }>('/documents/:id', async (request) => {
    const user = requireUser(request);
    // Ownership is checked before the body is validated.
    const document = await loadDocument(user.userId, request.params.id);
    const input = editDocumentSchema.parse(request.body ?? {});

    const current = document.content as unknown as GeneratedDocumentContent;
    const verified = await db.profileFact.findMany({
      where: { userId: user.userId, verified: true },
    });

    const candidate: GeneratedDocumentContent = {
      ...current,
      headline: input.content.headline,
      ...(input.content.summary !== undefined ? { summary: input.content.summary } : {}),
      sections: input.content.sections.map((section) => ({
        heading: section.heading,
        bullets: section.bullets,
        evidenceIds: section.evidenceIds,
      })),
      warnings: [],
      wordCount: 0,
    };

    const checked = checkEvidence({
      content: candidate,
      providedFacts: verified.map(toFactDto),
      verifiedFacts: verified.map(toFactDto),
    });

    const updated = await db.generatedDocument.update({
      where: { id: document.id },
      data: {
        content: {
          ...checked.content,
          wordCount: countWords(checked.content.sections, checked.content.summary),
        } as never,
        warnings: checked.warnings,
        status: checked.warnings.length > 0 ? 'needs_review' : 'draft',
        approvedAt: null,
      },
    });

    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'document.edited',
      entityType: 'generated_document',
      entityId: document.id,
    });

    return { document: toDocumentDto(updated) };
  });

  app.post<{ Params: { id: string } }>('/documents/:id/approve', async (request) => {
    const user = requireUser(request);
    // Load first so a non-owner always sees 404, regardless of body validity.
    await loadDocument(user.userId, request.params.id);
    const input = approveDocumentSchema.parse(request.body ?? {});
    const result = await service.approve({
      userId: user.userId,
      documentId: request.params.id,
      acknowledgeWarnings: input.acknowledgeWarnings,
    });
    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'document.approved',
      entityType: 'generated_document',
      entityId: result.id,
    });
    return result;
  });

  /** Export PDF/DOCX/TXT/JSON. Downloads are streamed, never public URLs. */
  app.get<{ Params: { id: string } }>('/documents/:id/export', async (request, reply) => {
    const user = requireUser(request);
    const format = exportDocumentSchema.parse(request.query).format;
    const document = await loadDocument(user.userId, request.params.id);

    if (format !== 'json' && document.status !== 'approved') {
      throw errors.conflict('Approve this document before exporting it.');
    }

    const payload = await exportInput(user.userId, document);
    const result = exportDocument(payload, format);
    const baseName = `${document.kind === 'resume' ? 'resume' : 'cover-letter'}-v${document.version}`;

    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'document.exported',
      entityType: 'generated_document',
      entityId: document.id,
    });

    return reply
      .header('content-type', result.contentType)
      .header('content-disposition', `attachment; filename="${baseName}.${result.extension}"`)
      .header('cache-control', 'private, no-store')
      .send(result.buffer);
  });

  app.delete<{ Params: { id: string } }>('/documents/:id', async (request, reply) => {
    const user = requireUser(request);
    const document = await loadDocument(user.userId, request.params.id);
    await db.generatedDocument.delete({ where: { id: document.id } });
    return reply.status(204).send();
  });
}

export function toDocumentDto(document: {
  id: string;
  jobId: string;
  kind: string;
  version: number;
  status: string;
  content: unknown;
  warnings: string[];
  providerId: string | null;
  model: string | null;
  promptVersion: string | null;
  createdAt: Date;
  approvedAt: Date | null;
}) {
  const content = document.content as unknown as GeneratedDocumentContent;
  return {
    id: document.id,
    jobId: document.jobId,
    kind: document.kind,
    version: document.version,
    status: document.status,
    content,
    warnings: document.warnings,
    words: content.wordCount,
    providerId: document.providerId,
    model: document.model,
    promptVersion: document.promptVersion,
    createdAt: document.createdAt.toISOString(),
    approvedAt: document.approvedAt?.toISOString() ?? null,
  };
}
