/**
 * Job handler registry.
 *
 * Handlers are thin: they validate their payload, then delegate to an injected
 * service. That keeps the queue mechanics testable without a database and makes
 * every background task idempotent by construction (the services use upserts and
 * idempotency keys).
 */

import { z } from 'zod';

export const scanUserPayloadSchema = z.object({
  userId: z.string().uuid(),
  trigger: z.enum(['manual', 'scheduled']),
  sources: z.array(z.string()).optional(),
  limitPerSource: z.number().int().min(1).max(100).optional(),
});

export const generateDocumentPayloadSchema = z.object({
  userId: z.string().uuid(),
  jobId: z.string().uuid(),
  kind: z.enum(['resume', 'cover_letter']),
  tone: z.enum(['professional', 'concise', 'warm']).optional(),
});

export const retentionPayloadSchema = z.object({
  dryRun: z.boolean().optional(),
});

export const notificationPayloadSchema = z.object({
  userId: z.string().uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string().optional(),
  link: z.string().optional(),
  dedupeKey: z.string(),
});

export type JobKind =
  'scan.user' | 'document.generate' | 'maintenance.retention' | 'notification.create';

export interface ServicePorts {
  scan: {
    runForUser(input: {
      userId: string;
      trigger: 'manual' | 'scheduled';
      sources?: string[] | undefined;
      limitPerSource?: number | undefined;
      idempotencyKey?: string | undefined;
    }): Promise<{ scanRunId: string; jobsNew: number; status: string }>;
  };
  documents: {
    generateForJob(input: {
      userId: string;
      jobId: string;
      kind: 'resume' | 'cover_letter';
      tone?: 'professional' | 'concise' | 'warm' | undefined;
    }): Promise<{ documentId: string; warnings: string[] }>;
  };
  retention: {
    purge(input: { dryRun: boolean }): Promise<Record<string, number>>;
  };
  notifications: {
    create(input: {
      userId: string;
      kind: string;
      title: string;
      body?: string | undefined;
      link?: string | undefined;
      dedupeKey: string;
    }): Promise<{ id: string; created: boolean }>;
  };
}

export function createHandlers(
  ports: ServicePorts,
): Record<string, (payload: unknown) => Promise<void>> {
  return {
    'scan.user': async (payload) => {
      const input = scanUserPayloadSchema.parse(payload);
      await ports.scan.runForUser({
        ...input,
        // A queued scan is idempotent per user+trigger+day for scheduled runs.
        ...(input.trigger === 'scheduled'
          ? {
              idempotencyKey: `queued-scan:${input.userId}:${new Date().toISOString().slice(0, 10)}`,
            }
          : {}),
      });
    },

    'document.generate': async (payload) => {
      const input = generateDocumentPayloadSchema.parse(payload);
      await ports.documents.generateForJob(input);
    },

    'maintenance.retention': async (payload) => {
      const input = retentionPayloadSchema.parse(payload);
      await ports.retention.purge({ dryRun: input.dryRun ?? false });
    },

    'notification.create': async (payload) => {
      const input = notificationPayloadSchema.parse(payload);
      await ports.notifications.create(input);
    },
  };
}
