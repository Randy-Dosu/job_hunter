/**
 * Privacy endpoints: export, deletion, audit trail.
 *
 * Deletion is immediate for data, with the account itself soft-deleted for a
 * short, documented grace period (RETENTION.accountDeletionGraceDays) so an
 * accidental deletion can be reversed by support, then hard-deleted.
 */

import type { FastifyInstance } from 'fastify';
import { CONSENT_VERSIONS, RETENTION } from '@job-hunter/config';
import type { AppContext } from '../app.js';
import { errors } from '../lib/errors.js';
import { requireUser } from './guards.js';
import { recordAudit } from '../lib/audit.js';
import { hashPassword, verifyPassword } from '../lib/security.js';
import { summarizeDataExport } from '../services/privacy-service.js';

export async function registerPrivacyRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db } = context;

  /** Full data export (JSON). Streamed with no-store headers. */
  app.get('/privacy/export', async (request, reply) => {
    const user = requireUser(request);

    const [
      profile,
      preferences,
      resumes,
      facts,
      matches,
      documents,
      applications,
      sessions,
      consents,
      notifications,
      audit,
    ] = await Promise.all([
      db.candidateProfile.findUnique({ where: { userId: user.userId } }),
      db.jobPreferences.findUnique({ where: { userId: user.userId } }),
      db.resume.findMany({
        where: { userId: user.userId, deletedAt: null },
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          parseStatus: true,
          createdAt: true,
        },
      }),
      db.profileFact.findMany({ where: { userId: user.userId } }),
      db.jobMatch.findMany({ where: { userId: user.userId } }),
      db.generatedDocument.findMany({ where: { userId: user.userId } }),
      db.application.findMany({
        where: { userId: user.userId },
        include: { job: { select: { title: true, company: true, url: true } } },
      }),
      db.browserSession.findMany({ where: { userId: user.userId } }),
      db.userConsent.findMany({ where: { userId: user.userId }, orderBy: { createdAt: 'desc' } }),
      db.notification.findMany({ where: { userId: user.userId } }),
      db.auditEvent.findMany({
        where: { userId: user.userId },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
    ]);

    const account = await db.user.findUnique({ where: { id: user.userId } });

    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      account: account
        ? {
            id: account.id,
            email: account.email,
            displayName: account.displayName,
            createdAt: account.createdAt,
          }
        : null,
      profile,
      preferences,
      resumes,
      facts,
      matches,
      documents,
      applications,
      browserSessions: sessions,
      consents,
      notifications,
      auditEvents: audit,
    };

    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'data.exported',
      entityType: 'user',
      entityId: user.userId,
    });

    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="job-hunter-export-${new Date().toISOString().slice(0, 10)}.json"`,
      )
      .header('cache-control', 'private, no-store')
      .send(JSON.stringify(payload, null, 2));
  });

  app.get('/privacy/summary', async (request) => {
    const user = requireUser(request);
    return summarizeDataExport(db, user.userId);
  });

  /** Delete the account. Requires the current password (re-authentication). */
  app.post('/privacy/delete', async (request, reply) => {
    const user = requireUser(request);
    const body = (request.body ?? {}) as { password?: unknown; confirm?: unknown };

    if (body.confirm !== 'DELETE') {
      throw errors.validation('Type DELETE to confirm account deletion');
    }
    if (typeof body.password !== 'string' || body.password.length === 0) {
      throw errors.validation('Enter your password to confirm deletion');
    }

    const record = await db.user.findUnique({ where: { id: user.userId } });
    if (!record) throw errors.unauthorized();

    const valid = await verifyPassword(body.password, record.passwordHash);
    if (!valid) throw errors.unauthorized('That password is not correct');

    // Revoke sessions immediately, then soft-delete the account for the grace window.
    await db.refreshToken.updateMany({
      where: { userId: user.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await db.user.update({
      where: { id: user.userId },
      data: {
        deletedAt: new Date(),
        disabledAt: new Date(),
        email: `deleted+${user.userId}@invalid.local`,
      },
    });

    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'account.deleted',
      entityType: 'user',
      entityId: user.userId,
    });

    return reply
      .header(
        'set-cookie',
        `${context.env.AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
      )
      .status(200)
      .send({
        deleted: true,
        graceDays: RETENTION.accountDeletionGraceDays,
        message: `Your account has been deactivated and will be permanently erased in ${RETENTION.accountDeletionGraceDays} days.`,
      });
  });

  /** Change password (invalidates other sessions). */
  app.post('/privacy/password', async (request) => {
    const user = requireUser(request);
    const body = (request.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
      throw errors.validation('Both your current and new password are required');
    }
    if (body.newPassword.length < 12) throw errors.validation('Use at least 12 characters');

    const record = await db.user.findUnique({ where: { id: user.userId } });
    if (!record) throw errors.unauthorized();
    const valid = await verifyPassword(body.currentPassword, record.passwordHash);
    if (!valid) throw errors.unauthorized('That password is not correct');

    await db.user.update({
      where: { id: user.userId },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });
    await db.refreshToken.updateMany({
      where: { userId: user.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { ok: true, message: 'Password changed. Please sign in again.' };
  });

  app.get('/privacy/audit', async (request) => {
    const user = requireUser(request);
    const events = await db.auditEvent.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, action: true, entityType: true, createdAt: true },
    });
    return {
      events: events.map((event) => ({
        id: event.id,
        action: event.action,
        entityType: event.entityType,
        createdAt: event.createdAt.toISOString(),
      })),
      retentionDays: RETENTION.auditEventDays,
      consentVersions: CONSENT_VERSIONS,
    };
  });
}
