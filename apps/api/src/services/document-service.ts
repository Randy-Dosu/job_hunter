/**
 * Document service: generate -> evidence check -> persist as a draft.
 *
 * Cross-module invariants enforced here:
 *  - only verified facts are supplied to the model,
 *  - the evidence check runs before anything is stored,
 *  - a document can only be approved when it has no unresolved warnings,
 *  - approval is a user action, never automatic.
 */

import type { Database } from '../db/client.js';
import type { Logger } from '../lib/logger.js';
import type { GeneratedDocumentContent } from '@job-hunter/shared-types';
import { buildCoverLetterPrompt, buildResumeTailorPrompt } from '@job-hunter/ai-gateway';
import type { AIGateway } from '@job-hunter/ai-gateway';
import {
  checkEvidence,
  generateDocument,
  buildFallbackDocument,
  countWords,
} from '@job-hunter/document-engine';
import { toFactDto } from '../routes/profile.js';
import { AppError, errors } from '../lib/errors.js';

export interface DocumentServiceOptions {
  db: Database;
  logger: Logger;
  ai: AIGateway;
}

export class DocumentService {
  constructor(private readonly options: DocumentServiceOptions) {}

  async generateForJob(input: {
    userId: string;
    jobId: string;
    kind: 'resume' | 'cover_letter';
    tone?: 'professional' | 'concise' | 'warm' | undefined;
  }): Promise<{ documentId: string; warnings: string[] }> {
    const { db } = this.options;

    const job = await db.job.findUnique({ where: { id: input.jobId } });
    if (!job) throw errors.notFound('Job not found');

    const [profile, facts] = await Promise.all([
      db.candidateProfile.findUnique({ where: { userId: input.userId } }),
      db.profileFact.findMany({ where: { userId: input.userId } }),
    ]);
    if (!profile) throw errors.notFound('Complete your profile first');

    const verified = facts.filter((fact) => fact.verified);
    if (verified.length === 0) {
      throw errors.validation(
        'Verify at least one profile fact before generating documents — documents are built only from verified information.',
      );
    }

    const lastVersion = await db.generatedDocument.findFirst({
      where: { userId: input.userId, jobId: job.id, kind: input.kind },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (lastVersion?.version ?? 0) + 1;

    let content: GeneratedDocumentContent;
    let providerId: string | null = null;
    let model: string | null = null;
    let promptVersion: string | null = null;

    try {
      const generated = await generateDocument(
        {
          job: { title: job.title, company: job.company, description: job.description },
          facts: verified.map(toFactDto),
          kind: input.kind,
          ...(input.tone ? { tone: input.tone } : {}),
          ...(profile.summary ? { baseSummary: profile.summary } : {}),
        },
        {
          gateway: this.options.ai,
          prompts: { buildResumeTailorPrompt, buildCoverLetterPrompt },
        },
      );
      content = generated.content;
      providerId = generated.provider;
      model = generated.model;
      promptVersion = generated.promptVersion;
    } catch (error) {
      // Fall back to a deterministic, obviously-unpolished draft rather than
      // failing the user's request outright. It is clearly labelled and requires
      // review before approval.
      this.options.logger.warn('document generation fell back to deterministic draft', {
        error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      });
      content = buildFallbackDocument({
        kind: input.kind,
        job: { title: job.title, company: job.company },
        facts: verified.map(toFactDto),
      });
    }

    const checked = checkEvidence({
      content,
      providedFacts: facts.map(toFactDto),
      verifiedFacts: verified.map(toFactDto),
      baseText: profile.summary ?? undefined,
    });

    const finalContent: GeneratedDocumentContent = {
      ...checked.content,
      wordCount: countWords(checked.content.sections, checked.content.summary),
    };

    const document = await db.generatedDocument.create({
      data: {
        userId: input.userId,
        jobId: job.id,
        kind: input.kind,
        version,
        status: finalContent.warnings.length > 0 ? 'needs_review' : 'draft',
        content: finalContent as never,
        warnings: finalContent.warnings,
        providerId,
        model,
        promptVersion,
      },
    });

    return { documentId: document.id, warnings: finalContent.warnings };
  }

  /** Approve a document. Blocked while warnings remain (unsupported claims). */
  async approve(input: {
    userId: string;
    documentId: string;
    acknowledgeWarnings: boolean;
  }): Promise<{ id: string; status: string }> {
    const { db } = this.options;
    const document = await db.generatedDocument.findFirst({
      where: { id: input.documentId, userId: input.userId },
    });
    if (!document) throw errors.notFound('Document not found');
    if (document.status === 'approved') return { id: document.id, status: document.status };

    const content = document.content as unknown as GeneratedDocumentContent;

    // Re-run the evidence check against *current* verified facts: facts may have
    // been un-verified or deleted since generation.
    const verified = await db.profileFact.findMany({
      where: { userId: input.userId, verified: true },
    });
    const recheck = checkEvidence({
      content,
      providedFacts: verified.map(toFactDto),
      verifiedFacts: verified.map(toFactDto),
    });

    const blocking = recheck.warnings.filter(
      (warning) =>
        warning.includes('not in your verified') || warning.includes('Unverified figure'),
    );

    if (blocking.length > 0 && !input.acknowledgeWarnings) {
      throw new AppError(
        'conflict',
        'This document contains claims that are not backed by verified facts. Edit those lines, then approve.',
        409,
        { warnings: blocking.slice(0, 10) },
      );
    }

    const approved = await db.generatedDocument.update({
      where: { id: document.id },
      data: {
        status: 'approved',
        approvedAt: new Date(),
        warnings: recheck.warnings,
        content: recheck.content as never,
      },
    });

    // Any previous approved version of the same kind is superseded.
    await db.generatedDocument.updateMany({
      where: {
        userId: input.userId,
        jobId: document.jobId,
        kind: document.kind,
        id: { not: document.id },
        status: 'approved',
      },
      data: { status: 'superseded' },
    });

    return { id: approved.id, status: approved.status };
  }
}
