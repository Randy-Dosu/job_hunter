/** Product-wide constants that are safe to share between server and browser. */

export const APP_NAME = 'Job Hunter';
export const APP_VERSION = '0.1.0';
export const API_PREFIX = '/api/v1';

/** Consent document versions — bump when terms/privacy text changes materially. */
export const CONSENT_VERSIONS = {
  terms: '2026-11-13',
  privacy: '2026-11-13',
  scheduled_scans: '2026-11-13',
  ai_processing: '2026-11-13',
  browser_assistance: '2026-11-13',
} as const;

export const LIMITS = {
  maxResumesPerUser: 10,
  maxScansPerDay: 6,
  maxDocumentsPerJob: 20,
  maxApplications: 2000,
  maxSavedAnswers: 100,
  pageSizeDefault: 20,
  pageSizeMax: 100,
  /** Number of jobs a single scan may ingest across all sources. */
  maxJobsPerScan: 250,
} as const;

export const RETENTION = {
  /** Audit events are kept this long, then purged by the maintenance job. */
  auditEventDays: 365,
  browserSessionDays: 30,
  notificationDays: 90,
  /** Deleted accounts are hard-deleted after this grace period. */
  accountDeletionGraceDays: 7,
} as const;

export const COOKIE = {
  name: 'jh_session',
  sameSite: 'Lax' as const,
  path: '/',
} as const;
