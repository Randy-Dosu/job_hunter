/**
 * Audit trail.
 *
 * Records security-relevant actions with minimal metadata. Failures to write an
 * audit row are logged but never break the user's request.
 */

import type { AuditAction } from '@job-hunter/shared-types';
import type { Database } from '../db/client.js';
import type { Logger } from './logger.js';

export interface AuditInput {
  userId?: string | undefined;
  action: AuditAction;
  entityType?: string | undefined;
  entityId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export async function recordAudit(db: Database, logger: Logger, input: AuditInput): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        ...(input.userId ? { userId: input.userId } : {}),
        action: input.action,
        ...(input.entityType ? { entityType: input.entityType } : {}),
        ...(input.entityId ? { entityId: input.entityId } : {}),
        ...(input.ip ? { ip: input.ip.slice(0, 64) } : {}),
        ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 200) } : {}),
      },
    });
  } catch (error) {
    logger.warn('audit write failed', {
      action: input.action,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}
