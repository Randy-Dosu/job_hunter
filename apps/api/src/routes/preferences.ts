import type { FastifyInstance } from 'fastify';
import { autoPrepareSchema, jobPreferencesSchema, scheduleSchema } from '@job-hunter/validation';
import {
  AUTOMATED_CONNECTORS,
  SOURCE_REGISTER,
  getManualHandoffSources,
} from '@job-hunter/job-connectors';
import type { AppContext } from '../app.js';
import { requireUser } from './guards.js';
import { toJobPreferences } from '../services/auth-service.js';
import { recordAudit } from '../lib/audit.js';

export async function registerPreferencesRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const { db } = context;

  app.get('/preferences', async (request) => {
    const user = requireUser(request);
    const row = await db.jobPreferences.findUnique({ where: { userId: user.userId } });
    const schedule = await db.scanSchedule.findUnique({ where: { userId: user.userId } });
    return {
      preferences: row ? toJobPreferences(row) : null,
      // Preparation, not submission: the system assembles, the user sends.
      autoPrepare: row
        ? {
            enabled: row.autoPrepareEnabled,
            minScore: row.autoPrepareMinScore,
            dailyLimit: row.autoPrepareDailyLimit,
            documentKinds: row.autoPrepareDocumentKinds,
          }
        : null,
      schedule: schedule
        ? {
            enabled: schedule.enabled,
            timeZone: schedule.timeZone,
            scanHourLocal: schedule.hourLocal,
            lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
            nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
          }
        : null,
    };
  });

  app.put('/preferences', async (request) => {
    const user = requireUser(request);
    const input = jobPreferencesSchema.parse(request.body);

    const row = await db.jobPreferences.upsert({
      where: { userId: user.userId },
      create: {
        userId: user.userId,
        targetTitles: input.targetTitles,
        targetKeywords: input.targetKeywords,
        excludedKeywords: input.excludedKeywords,
        excludedCompanies: input.excludedCompanies,
        locations: input.locations,
        countryCodes: input.countryCodes,
        remoteOnly: input.remoteOnly,
        workplaceTypes: input.workplaceTypes,
        employmentTypes: input.employmentTypes,
        seniorityLevels: input.seniorityLevels,
        minSalary: input.minSalary ?? null,
        salaryCurrency: input.salaryCurrency ?? null,
        enabledSources: input.enabledSources,
        timeZone: input.timeZone,
        scanHourLocal: input.scanHourLocal,
      },
      update: {
        targetTitles: input.targetTitles,
        targetKeywords: input.targetKeywords,
        excludedKeywords: input.excludedKeywords,
        excludedCompanies: input.excludedCompanies,
        locations: input.locations,
        countryCodes: input.countryCodes,
        remoteOnly: input.remoteOnly,
        workplaceTypes: input.workplaceTypes,
        employmentTypes: input.employmentTypes,
        seniorityLevels: input.seniorityLevels,
        minSalary: input.minSalary ?? null,
        salaryCurrency: input.salaryCurrency ?? null,
        enabledSources: input.enabledSources,
        timeZone: input.timeZone,
        scanHourLocal: input.scanHourLocal,
      },
    });

    // Keep the schedule row in sync with the preference time zone/hour.
    await db.scanSchedule.upsert({
      where: { userId: user.userId },
      create: { userId: user.userId, timeZone: input.timeZone, hourLocal: input.scanHourLocal },
      update: { timeZone: input.timeZone, hourLocal: input.scanHourLocal },
    });

    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'preferences.updated',
      entityType: 'job_preferences',
      entityId: row.id,
    });

    return { preferences: toJobPreferences(row) };
  });

  /**
   * Turn automatic application preparation on/off and set its limits.
   *
   * There is no `submit` field, here or anywhere else. Enabling this lets the
   * system build packages for matching jobs; it never sends them, and the
   * response says so.
   */
  app.put('/preferences/auto-prepare', async (request) => {
    const user = requireUser(request);
    const input = autoPrepareSchema.parse(request.body);

    const row = await db.jobPreferences.upsert({
      where: { userId: user.userId },
      create: {
        userId: user.userId,
        autoPrepareEnabled: input.enabled,
        autoPrepareMinScore: input.minScore,
        autoPrepareDailyLimit: input.dailyLimit,
        autoPrepareDocumentKinds: input.documentKinds,
      },
      update: {
        autoPrepareEnabled: input.enabled,
        autoPrepareMinScore: input.minScore,
        autoPrepareDailyLimit: input.dailyLimit,
        autoPrepareDocumentKinds: input.documentKinds,
      },
    });

    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'preferences.updated',
      entityType: 'job_preferences',
      entityId: row.id,
    });

    return {
      autoPrepare: {
        enabled: row.autoPrepareEnabled,
        minScore: row.autoPrepareMinScore,
        dailyLimit: row.autoPrepareDailyLimit,
        documentKinds: row.autoPrepareDocumentKinds,
      },
      // Stated on every write so no client can imply otherwise.
      guarantee: 'Prepared packages are never submitted. You review and send each one yourself.',
    };
  });

  /** Pause/resume the daily scan and set the local run hour. */
  app.put('/preferences/schedule', async (request) => {
    const user = requireUser(request);
    const input = scheduleSchema.parse(request.body);

    await db.jobPreferences.upsert({
      where: { userId: user.userId },
      create: { userId: user.userId, timeZone: input.timeZone, scanHourLocal: input.scanHourLocal },
      update: { timeZone: input.timeZone, scanHourLocal: input.scanHourLocal },
    });

    const schedule = await db.scanSchedule.upsert({
      where: { userId: user.userId },
      create: {
        userId: user.userId,
        enabled: input.enabled,
        timeZone: input.timeZone,
        hourLocal: input.scanHourLocal,
      },
      update: { enabled: input.enabled, timeZone: input.timeZone, hourLocal: input.scanHourLocal },
    });

    await recordAudit(db, context.logger, {
      userId: user.userId,
      action: 'preferences.updated',
      entityType: 'scan_schedule',
      entityId: schedule.id,
    });

    return {
      schedule: {
        enabled: schedule.enabled,
        timeZone: schedule.timeZone,
        scanHourLocal: schedule.hourLocal,
        lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
        nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
      },
    };
  });

  /**
   * The source register: what is automated, what is manual handoff and why.
   * This is the transparency surface required by the compliance rules.
   */
  app.get('/sources', async (request) => {
    requireUser(request);
    const prefs = await db.jobPreferences.findUnique({ where: { userId: request.auth!.userId } });
    const enabled = prefs?.enabledSources ?? [];

    return {
      sources: SOURCE_REGISTER.map((entry) => ({
        id: entry.id,
        name: entry.name,
        family: entry.family,
        accessMethod: entry.accessMethod,
        complianceNote: entry.complianceNote,
        review: entry.review,
        automated: entry.accessMethod === 'public_api',
        configured: entry.connector ? entry.connector.isConfigured() : false,
        enabledByDefault: enabled.includes(entry.id),
        docsUrl: entry.connector?.docsUrl ?? null,
      })),
      automatedCount: AUTOMATED_CONNECTORS.length,
      manualHandoff: getManualHandoffSources(enabled).map((entry) => ({
        id: entry.id,
        name: entry.name,
        complianceNote: entry.complianceNote,
      })),
    };
  });

  /** Pre-filled search links so the user can search a site manually. */
  app.get('/sources/manual-links', async (request) => {
    const user = requireUser(request);
    const prefs = await db.jobPreferences.findUnique({ where: { userId: user.userId } });
    if (!prefs) return { links: [] };

    const links = getManualHandoffSources(prefs.enabledSources)
      .map((entry) => {
        if (!entry.manualSearchUrl) return undefined;
        return {
          id: entry.id,
          name: entry.name,
          url: entry.manualSearchUrl({ titles: prefs.targetTitles, locations: prefs.locations }),
          note: entry.complianceNote,
        };
      })
      .filter((link): link is NonNullable<typeof link> => link !== undefined);

    return { links };
  });
}
