/**
 * Response shapes used by the UI.
 *
 * These mirror the API contract in docs/api-contracts.md. They are declared here
 * (rather than imported from the server) so the browser bundle never pulls in
 * server-only modules.
 */

export type ApplicationStatus =
  | 'saved'
  | 'preparing'
  | 'ready_for_user'
  | 'applied'
  | 'assessment'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'
  | 'closed';

export type MatchBand = 'strong' | 'good' | 'fair' | 'weak';
export type Freshness = 'new' | 'fresh' | 'aging' | 'stale' | 'expired' | 'unknown';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
}

export interface Consent {
  kind: string;
  granted: boolean;
  version: string;
  createdAt: string;
}

export interface MeResponse {
  user: User;
  consents: Consent[];
  consentVersions: Record<string, string>;
}

export interface ProfileFact {
  id: string;
  kind: 'skill' | 'experience' | 'education' | 'certification' | 'project' | 'language' | 'summary';
  label: string;
  detail?: string | null;
  organisation?: string | null;
  role?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  keywords: string[];
  verified: boolean;
  verifiedAt?: string | null;
  source: string;
}

export interface ProfileContent {
  contact: {
    fullName?: string;
    email?: string;
    phone?: string;
    location?: string;
    website?: string;
    linkedin?: string;
    github?: string;
  };
  headline?: string;
  summary?: string;
  skills: string[];
  experience: Array<{
    company: string;
    title: string;
    startDate?: string;
    endDate?: string;
    current?: boolean;
    location?: string;
    bullets: string[];
    keywords: string[];
  }>;
  education: Array<{
    institution: string;
    degree?: string;
    field?: string;
    startDate?: string;
    endDate?: string;
    grade?: string;
  }>;
  projects: Array<{ name: string; description: string; url?: string; keywords: string[] }>;
  certifications: Array<{
    name: string;
    issuer?: string;
    issuedAt?: string;
    expiresAt?: string;
    credentialUrl?: string;
  }>;
  languages: string[];
}

export interface ProfileRecord {
  id: string;
  content: ProfileContent;
  headline?: string | null;
  summary?: string | null;
  version: number;
  updatedAt: string;
}

/** `GET /profile` — the profile record only. Facts are served separately. */
export interface ProfileResponse {
  profile: ProfileRecord;
}

/** `GET /profile/facts` — every extracted or manually added claim. */
export interface FactsResponse {
  facts: ProfileFact[];
  summary: {
    total: number;
    verified: number;
    unverified: number;
    byKind: Record<string, { total: number; verified: number }>;
  };
}

export interface JobPreferences {
  targetTitles: string[];
  targetKeywords: string[];
  excludedKeywords: string[];
  excludedCompanies: string[];
  locations: string[];
  countryCodes: string[];
  remoteOnly: boolean;
  workplaceTypes: string[];
  employmentTypes: string[];
  seniorityLevels: string[];
  minSalary?: number | null;
  salaryCurrency?: string | null;
  enabledSources: string[];
  timeZone: string;
  scanHourLocal: number;
}

export interface ScanSchedule {
  enabled: boolean;
  timeZone: string;
  scanHourLocal: number;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

export interface PreferencesResponse {
  preferences: JobPreferences | null;
  schedule: ScanSchedule | null;
}

export interface PrivacySummary {
  counts: Record<string, number>;
  retention: Record<string, number>;
  note: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType?: string | null;
  createdAt: string;
}

export interface MatchBreakdownRow {
  label: string;
  scorePercent: number | null;
  weightPercent: number;
  points: number;
  rationale: string;
  unknowns: string[];
  status: 'match' | 'partial' | 'gap' | 'unknown';
}

export interface MatchSummary {
  score: number;
  band: MatchBand;
  scoringVersion: string;
}

export interface JobListItem {
  id: string;
  title: string;
  company: string;
  companyLogoUrl?: string | null;
  url: string;
  source: string;
  sources: string[];
  location: {
    raw?: string | null;
    countryCode?: string | null;
    remote: boolean;
    workplace: string;
  };
  employmentType: string;
  seniority: string;
  salary?: {
    min?: number | null;
    max?: number | null;
    currency?: string | null;
    period?: string | null;
  } | null;
  tags: string[];
  freshness: Freshness;
  postedAt?: string | null;
  firstSeenAt: string;
  match?: (MatchSummary & { summary?: string }) | null;
  saved: boolean;
  dismissed: boolean;
}

export interface JobListResponse {
  items: JobListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** A verified fact that satisfies a specific job requirement. */
export interface MatchEvidenceItem {
  dimension: string;
  factId?: string;
  factLabel: string;
  requirement: string;
  strength: 'strong' | 'moderate' | 'weak';
}

/** `missing_evidence` = we looked and found nothing; `unknown` = we could not tell. */
export interface MatchGapItem {
  dimension: string;
  requirement: string;
  kind: 'missing_evidence' | 'unknown';
  detail: string;
}

export interface JobDetailResponse {
  job: Omit<JobListItem, 'saved' | 'dismissed' | 'match'> & {
    description: string;
    lastCheckedAt: string;
  };
  match:
    | (MatchSummary & {
        profileVersion: string;
        usedSemantic: boolean;
        computedAt: string;
        breakdown: MatchBreakdownRow[];
        evidence: MatchEvidenceItem[];
        gaps: MatchGapItem[];
        unknowns: MatchGapItem[];
        excluded: boolean;
        exclusionReason?: string | null;
      })
    | null;
  state: { saved: boolean; dismissed: boolean; feedback?: string | null };
  application?: { id: string; status: ApplicationStatus } | null;
  documents: DocumentSummary[];
}

export interface GeneratedDocument {
  id: string;
  jobId: string;
  kind: 'resume' | 'cover_letter';
  version: number;
  status: 'draft' | 'needs_review' | 'approved' | 'superseded';
  headline?: string;
  content: {
    kind: string;
    headline: string;
    summary?: string;
    sections: Array<{ heading: string; bullets: string[]; evidenceIds: string[] }>;
    warnings: string[];
    wordCount: number;
  };
  warnings: string[];
  words?: number;
  providerId?: string | null;
  model?: string | null;
  createdAt: string;
  approvedAt?: string | null;
}

/** The trimmed document shape embedded in job detail and application responses. */
export interface DocumentSummary {
  id: string;
  jobId?: string;
  kind: 'resume' | 'cover_letter';
  version: number;
  status: 'draft' | 'needs_review' | 'approved' | 'superseded';
  createdAt: string;
  warnings: string[];
}

/** `GET /documents/:id` — the document plus ATS linting for the export view. */
export interface DocumentDetailResponse {
  document: GeneratedDocument;
  job: { title: string; company: string; url: string } | null;
  plainText: string;
  atsIssues: string[];
}

export interface Application {
  id: string;
  status: ApplicationStatus;
  statusLabel: string;
  notes?: string | null;
  nextActionAt?: string | null;
  appliedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  resumeDocumentId?: string | null;
  coverLetterDocumentId?: string | null;
  job: {
    id: string;
    title: string;
    company: string;
    url: string;
    source: string;
    locationRaw?: string | null;
  } | null;
  lastEvent?: { type: string; message?: string | null; createdAt: string } | null;
}

export interface ApplicationListResponse {
  items: Application[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
}

export interface ApplicationEvent {
  id: string;
  type: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  message?: string | null;
  createdAt: string;
}

/** `GET /applications/:id` — includes transitions the server will accept. */
export interface ApplicationDetailResponse {
  application: Application & {
    documents: DocumentSummary[];
    allowedTransitions: ApplicationStatus[];
    events: ApplicationEvent[];
  };
}

export interface SourceInfo {
  id: string;
  name: string;
  family: string;
  accessMethod: 'public_api' | 'manual_handoff' | 'disabled';
  complianceNote: string;
  automated: boolean;
  configured: boolean;
  enabledByDefault: boolean;
  docsUrl?: string | null;
}

export interface SourcesResponse {
  sources: SourceInfo[];
  automatedCount: number;
  manualHandoff: Array<{ id: string; name: string; complianceNote: string }>;
}

export interface ScanSourceRun {
  source: string;
  status: string;
  fetched: number;
  durationMs?: number | null;
  error?: string | null;
  note?: string | null;
}

export interface ScanRun {
  id: string;
  trigger: 'manual' | 'scheduled';
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
  startedAt: string;
  finishedAt?: string | null;
  jobsFound: number;
  jobsNew: number;
  jobsUpdated: number;
  errorSummary?: string | null;
  sources: ScanSourceRun[];
}

export interface ScanListResponse {
  scans: ScanRun[];
}

export interface DashboardTopMatch {
  jobId: string;
  score: number;
  band: MatchBand;
  title: string;
  company: string;
  location?: string | null;
  remote: boolean;
  source: string;
  freshness: Freshness;
}

export interface DashboardResponse {
  jobs: {
    total: number;
    newLast24h: number;
    highMatches: number;
    topMatches: DashboardTopMatch[];
  };
  applications: {
    total: number;
    byStatus: Record<string, number>;
    upcoming: Array<{
      id: string;
      status: ApplicationStatus;
      nextActionAt?: string | null;
      job: { title: string; company: string } | null;
    }>;
  };
  scan: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt?: string | null;
    jobsFound: number;
    jobsNew: number;
    errorSummary?: string | null;
    sources: Array<{ source: string; status: string; fetched: number; error?: string | null }>;
  } | null;
  schedule: {
    enabled: boolean;
    timeZone: string;
    scanHourLocal: number;
    lastRunAt?: string | null;
    nextRunAt?: string | null;
    dueNow: boolean;
  } | null;
  profile: { verifiedFacts: number; unverifiedFacts: number; resumes: number; ready: boolean };
  documents: { awaitingReview: number };
  notifications: { unread: number };
}

export interface NotificationListResponse {
  items: NotificationItem[];
  unreadCount: number;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface BrowserCapabilities {
  enabled: boolean;
  allowlist: Array<{ host: string; displayName: string; complianceNote: string }>;
  guarantees: string[];
}

export interface BrowserSession {
  id: string;
  jobId: string;
  status:
    | 'pending_consent'
    | 'active'
    | 'paused_for_user'
    | 'blocked'
    | 'completed'
    | 'cancelled'
    | 'expired';
  pauseReason?: string | null;
  applicationUrl: string;
  expiresAt: string;
  fields?: Array<{
    selector: string;
    label: string;
    type: string;
    required: boolean;
    value: string | null;
    sensitive: boolean;
    confidence: 'high' | 'low';
    skippedReason?: string;
  }>;
}

export interface ResumeRecord {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  parseStatus: 'pending' | 'processing' | 'parsed' | 'failed';
  parseError?: string | null;
  isPrimary: boolean;
  uploadedAt: string;
}

export interface ResumeListResponse {
  resumes: ResumeRecord[];
}
