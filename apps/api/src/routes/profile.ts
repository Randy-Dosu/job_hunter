import type { FastifyInstance } from 'fastify';
import {
  createFactSchema,
  updateFactSchema,
  updateProfileSchema,
  verifyFactsSchema,
  answerBankSchema,
} from '@job-hunter/validation';
import { FACT_KINDS, type FactKind, type ProfileFact } from '@job-hunter/shared-types';
import type { AppContext } from '../app.js';
import { errors } from '../lib/errors.js';
import { requireUser } from './guards.js';
import { recordAudit } from '../lib/audit.js';

export async function registerProfileRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db } = context;

  async function ensureProfile(userId: string) {
    const existing = await db.candidateProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return db.candidateProfile.create({
      data: {
        userId,
        content: {
          contact: { fullName: '', email: '' },
          skills: [],
          experience: [],
          education: [],
          projects: [],
          certifications: [],
          languages: [],
        },
      },
    });
  }

  app.get('/profile', async (request) => {
    const user = requireUser(request);
    const profile = await ensureProfile(user.userId);
    return {
      profile: {
        id: profile.id,
        content: profile.content,
        headline: profile.headline,
        summary: profile.summary,
        version: profile.version,
        updatedAt: profile.updatedAt.toISOString(),
      },
    };
  });

  app.put('/profile', async (request) => {
    const user = requireUser(request);
    const input = updateProfileSchema.parse(request.body);
    await ensureProfile(user.userId);

    const profile = await db.candidateProfile.update({
      where: { userId: user.userId },
      data: {
        content: input.content,
        headline: input.headline ?? input.content.headline ?? null,
        summary: input.summary ?? input.content.summary ?? null,
        version: { increment: 1 },
      },
    });

    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'profile.updated',
      entityType: 'candidate_profile',
      entityId: profile.id,
    });

    return {
      profile: {
        id: profile.id,
        content: profile.content,
        headline: profile.headline,
        summary: profile.summary,
        version: profile.version,
        updatedAt: profile.updatedAt.toISOString(),
      },
    };
  });

  // ------------------------------------------------------------------ facts
  app.get('/profile/facts', async (request) => {
    const user = requireUser(request);
    const query = request.query as { kind?: string; verified?: string };
    const where: Record<string, unknown> = { userId: user.userId };
    if (query.kind && (FACT_KINDS as readonly string[]).includes(query.kind))
      where.kind = query.kind;
    if (query.verified === 'true') where.verified = true;
    if (query.verified === 'false') where.verified = false;

    const facts = await db.profileFact.findMany({
      where,
      orderBy: [{ verified: 'asc' }, { kind: 'asc' }, { createdAt: 'asc' }],
    });
    return { facts: facts.map(toFactDto), summary: summarizeFacts(facts) };
  });

  app.post('/profile/facts', async (request, reply) => {
    const user = requireUser(request);
    const input = createFactSchema.parse(request.body);
    const fact = await db.profileFact.create({
      data: {
        userId: user.userId,
        kind: input.kind,
        label: input.label,
        detail: input.detail ?? null,
        keywords: input.keywords,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        organisation: input.organisation ?? null,
        role: input.role ?? null,
        evidenceRef: input.evidenceRef ?? null,
        source: 'manual',
        // Manual entries still need explicit verification before use as evidence.
        verified: false,
      },
    });
    return reply.status(201).send({ fact: toFactDto(fact) });
  });

  app.patch<{ Params: { id: string } }>('/profile/facts/:id', async (request) => {
    const user = requireUser(request);
    const input = updateFactSchema.parse(request.body);

    const existing = await db.profileFact.findFirst({
      where: { id: request.params.id, userId: user.userId },
    });
    if (!existing) throw errors.notFound('That fact was not found');

    const fact = await db.profileFact.update({
      where: { id: existing.id },
      data: {
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.detail !== undefined ? { detail: input.detail } : {}),
        ...(input.keywords !== undefined ? { keywords: input.keywords } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
        ...(input.organisation !== undefined ? { organisation: input.organisation } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.verified !== undefined
          ? { verified: input.verified, verifiedAt: input.verified ? new Date() : null }
          : {}),
      },
    });
    return { fact: toFactDto(fact) };
  });

  app.delete<{ Params: { id: string } }>('/profile/facts/:id', async (request, reply) => {
    const user = requireUser(request);
    const deleted = await db.profileFact.deleteMany({
      where: { id: request.params.id, userId: user.userId },
    });
    if (deleted.count === 0) throw errors.notFound('That fact was not found');
    return reply.status(204).send();
  });

  /** Bulk verification — the main "confirm your details" screen action. */
  app.post('/profile/facts/verify', async (request) => {
    const user = requireUser(request);
    const input = verifyFactsSchema.parse(request.body);

    const result = await db.profileFact.updateMany({
      where: { id: { in: input.factIds }, userId: user.userId },
      data: { verified: input.verified, verifiedAt: input.verified ? new Date() : null },
    });

    if (result.count > 0) {
      await recordAudit(db, context.logger, {
        userId: user.userId,
        action: 'facts.verified',
        entityType: 'profile_fact',
        entityId: `${result.count} facts`,
      });
    }
    return { updated: result.count, verified: input.verified };
  });

  // ------------------------------------------------------------- answer bank
  app.get('/profile/answers', async (request) => {
    const user = requireUser(request);
    const record = await db.answerBankEntry.findUnique({ where: { userId: user.userId } });
    return { answers: (record?.answers as Record<string, string> | null) ?? {} };
  });

  app.put('/profile/answers', async (request) => {
    const user = requireUser(request);
    const input = answerBankSchema.parse(request.body);
    const record = await db.answerBankEntry.upsert({
      where: { userId: user.userId },
      create: { userId: user.userId, answers: input.answers },
      update: { answers: input.answers },
    });
    return { answers: record.answers as Record<string, string> };
  });
}

export function toFactDto(fact: {
  id: string;
  kind: string;
  label: string;
  detail: string | null;
  keywords: string[];
  startDate: string | null;
  endDate: string | null;
  organisation: string | null;
  role: string | null;
  source: string;
  verified: boolean;
  evidenceRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: fact.id,
    kind: fact.kind as FactKind,
    label: fact.label,
    ...(fact.detail ? { detail: fact.detail } : {}),
    keywords: fact.keywords,
    ...(fact.startDate ? { startDate: fact.startDate } : {}),
    ...(fact.endDate ? { endDate: fact.endDate } : {}),
    ...(fact.organisation ? { organisation: fact.organisation } : {}),
    ...(fact.role ? { role: fact.role } : {}),
    source: fact.source as ProfileFact['source'],
    verified: fact.verified,
    ...(fact.evidenceRef ? { evidenceRef: fact.evidenceRef } : {}),
    createdAt: fact.createdAt.toISOString(),
    updatedAt: fact.updatedAt.toISOString(),
  } satisfies ProfileFact;
}

function summarizeFacts(facts: Array<{ kind: string; verified: boolean }>) {
  const byKind: Record<string, { total: number; verified: number }> = {};
  for (const fact of facts) {
    const entry = (byKind[fact.kind] ??= { total: 0, verified: 0 });
    entry.total += 1;
    if (fact.verified) entry.verified += 1;
  }
  return {
    total: facts.length,
    verified: facts.filter((fact) => fact.verified).length,
    unverified: facts.filter((fact) => !fact.verified).length,
    byKind,
  };
}
