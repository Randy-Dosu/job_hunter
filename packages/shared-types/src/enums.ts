/**
 * Shared domain vocabulary.
 *
 * These enums are the single source of truth for stored values. They are
 * exported as `const` tuples so validation schemas, the API and the UI all
 * stay in sync without duplicating string literals.
 */

export const JOB_SOURCE_IDS = [
  'remoteok',
  'weworkremotely',
  'remotive',
  'jobicy',
  'arbeitnow',
  'greenhouse',
  'lever',
  'linkedin',
  'indeed',
  'google_jobs',
  'wellfound',
  'company_careers',
] as const;
export type JobSourceId = (typeof JOB_SOURCE_IDS)[number];

/**
 * How a connector is permitted to reach a source.
 *
 * - `public_api`        Official, documented, unauthenticated JSON API or feed.
 * - `manual_handoff`    No automation is permitted/enabled: we build a deep
 *                       link and the user searches/reads on the source itself.
 * - `disabled`          Reviewed and switched off (terms, access or quality).
 */
export const SOURCE_ACCESS_METHODS = ['public_api', 'manual_handoff', 'disabled'] as const;
export type SourceAccessMethod = (typeof SOURCE_ACCESS_METHODS)[number];

export const SOURCE_FAMILIES = ['aggregator', 'company_careers', 'marketplace', 'board'] as const;
export type SourceFamily = (typeof SOURCE_FAMILIES)[number];

export const SOURCE_HEALTH_STATES = ['healthy', 'degraded', 'failing', 'unknown'] as const;
export type SourceHealthState = (typeof SOURCE_HEALTH_STATES)[number];

export const SCAN_TRIGGERS = ['manual', 'scheduled'] as const;
export type ScanTrigger = (typeof SCAN_TRIGGERS)[number];

export const SCAN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const SOURCE_RUN_STATUSES = ['pending', 'succeeded', 'failed', 'skipped'] as const;
export type SourceRunStatus = (typeof SOURCE_RUN_STATUSES)[number];

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'temporary',
  'internship',
  'freelance',
  'unknown',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const WORKPLACE_TYPES = ['remote', 'hybrid', 'onsite', 'unknown'] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

export const SENIORITY_LEVELS = [
  'internship',
  'entry',
  'junior',
  'mid',
  'senior',
  'lead',
  'principal',
  'director',
  'executive',
  'unknown',
] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

export const FRESHNESS_STATES = ['new', 'fresh', 'aging', 'stale', 'expired', 'unknown'] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export const JOB_STATUSES = ['active', 'expired', 'closed', 'unknown'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const FACT_KINDS = [
  'skill',
  'experience',
  'education',
  'project',
  'certification',
  'language',
  'achievement',
  'summary',
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FACT_SOURCES = ['resume_parse', 'manual'] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

export const RESUME_PARSE_STATUSES = ['pending', 'parsing', 'parsed', 'failed'] as const;
export type ResumeParseStatus = (typeof RESUME_PARSE_STATUSES)[number];

export const DOCUMENT_KINDS = ['resume', 'cover_letter'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_STATUSES = ['draft', 'needs_review', 'approved', 'superseded'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const EXPORT_FORMATS = ['pdf', 'docx', 'txt', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const APPLICATION_STATUSES = [
  'saved',
  'preparing',
  'ready_for_user',
  'applied',
  'assessment',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
  'closed',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  preparing: 'Preparing',
  ready_for_user: 'Ready for you',
  applied: 'Applied',
  assessment: 'Assessment',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  closed: 'Closed',
};

/** Allowed status transitions. Prevents nonsensical history (e.g. offer -> saved). */
export const APPLICATION_STATUS_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  saved: ['preparing', 'ready_for_user', 'withdrawn', 'closed'],
  preparing: ['ready_for_user', 'applied', 'saved', 'withdrawn', 'closed'],
  ready_for_user: ['applied', 'preparing', 'withdrawn', 'closed'],
  applied: ['assessment', 'interview', 'rejected', 'offer', 'withdrawn', 'closed'],
  assessment: ['interview', 'rejected', 'withdrawn', 'closed'],
  interview: ['offer', 'rejected', 'withdrawn', 'closed'],
  offer: ['closed', 'withdrawn'],
  rejected: ['closed'],
  withdrawn: ['closed'],
  closed: [],
};

export const BROWSER_SESSION_STATUSES = [
  'pending_consent',
  'active',
  'paused_for_user',
  'completed',
  'cancelled',
  'expired',
  'blocked',
] as const;
export type BrowserSessionStatus = (typeof BROWSER_SESSION_STATUSES)[number];

/** Reasons the assistant must stop and hand control to the human. */
export const BROWSER_PAUSE_REASONS = [
  'user_review',
  'captcha',
  'login_required',
  'unsupported_form',
  'unknown_field',
  'access_restriction',
  'site_not_allowlisted',
  'session_expired',
  'error',
] as const;
export type BrowserPauseReason = (typeof BROWSER_PAUSE_REASONS)[number];

export const BROWSER_ACTION_TYPES = [
  'session_started',
  'navigated',
  'form_detected',
  'field_filled',
  'field_skipped',
  'paused',
  'resumed',
  'handed_off',
  'session_ended',
] as const;
export type BrowserActionType = (typeof BROWSER_ACTION_TYPES)[number];

export const NOTIFICATION_KINDS = [
  'scan_completed',
  'scan_failed',
  'high_match_found',
  'document_ready',
  'application_reminder',
  'system',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const CONSENT_KINDS = [
  'terms',
  'privacy',
  'scheduled_scans',
  'ai_processing',
  'browser_assistance',
] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const AUDIT_ACTIONS = [
  'auth.sign_up',
  'auth.sign_in',
  'auth.sign_in_failed',
  'auth.sign_out',
  'profile.updated',
  'preferences.updated',
  'resume.uploaded',
  'resume.parsed',
  'resume.deleted',
  'facts.verified',
  'scan.started',
  'scan.completed',
  'scan.failed',
  'scan.cancelled',
  'match.calculated',
  'document.generated',
  'document.edited',
  'document.approved',
  'document.exported',
  'browser_session.started',
  'browser_session.paused',
  'browser_session.ended',
  'application.created',
  'application.status_changed',
  'consent.recorded',
  'data.exported',
  'data.deletion_requested',
  'account.deleted',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AI_TASKS = [
  'job_semantic_match',
  'resume_tailor',
  'cover_letter',
  'resume_parse_extract',
] as const;
export type AITask = (typeof AI_TASKS)[number];

export const AI_PROVIDER_IDS = ['groq', 'gemini', 'openrouter', 'huggingface', 'mock'] as const;
export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];
