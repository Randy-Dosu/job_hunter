-- Job Hunter initial schema (Sprint 1).
--
-- Kept as explicit SQL so it applies identically to a local PGlite instance and
-- to Supabase PostgreSQL. Column names match the Prisma schema exactly (Prisma
-- maps model/field names to table/column names verbatim).

-- gen_random_uuid() is built into PostgreSQL 13+ (and PGlite). No extension needed.

-- ---------------------------------------------------------------- identity
CREATE TABLE "User" (
    "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "email"         TEXT NOT NULL,
    "passwordHash"  TEXT NOT NULL,
    "displayName"   TEXT NOT NULL,
    "role"          TEXT NOT NULL DEFAULT 'user',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "disabledAt"    TIMESTAMP(3),
    "lastLoginAt"   TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"     TIMESTAMP(3)
);
CREATE UNIQUE INDEX "User_email_key" ON "User" ("email");
CREATE INDEX "User_deletedAt_idx" ON "User" ("deletedAt");

CREATE TABLE "RefreshToken" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"    TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken" ("tokenHash");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken" ("userId");

-- ---------------------------------------------------------------- profile
CREATE TABLE "CandidateProfile" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"    TEXT NOT NULL,
    "content"   JSONB NOT NULL,
    "headline"  TEXT,
    "summary"   TEXT,
    "version"   INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CandidateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "CandidateProfile_userId_key" ON "CandidateProfile" ("userId");

CREATE TABLE "JobPreferences" (
    "id"                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"            TEXT NOT NULL,
    "targetTitles"      TEXT[] NOT NULL DEFAULT '{}',
    "targetKeywords"    TEXT[] NOT NULL DEFAULT '{}',
    "excludedKeywords"  TEXT[] NOT NULL DEFAULT '{}',
    "excludedCompanies" TEXT[] NOT NULL DEFAULT '{}',
    "locations"         TEXT[] NOT NULL DEFAULT '{}',
    "countryCodes"      TEXT[] NOT NULL DEFAULT '{}',
    "remoteOnly"        BOOLEAN NOT NULL DEFAULT false,
    "workplaceTypes"    TEXT[] NOT NULL DEFAULT '{}',
    "employmentTypes"   TEXT[] NOT NULL DEFAULT '{}',
    "seniorityLevels"   TEXT[] NOT NULL DEFAULT '{}',
    "minSalary"         INTEGER,
    "salaryCurrency"    TEXT,
    "enabledSources"    TEXT[] NOT NULL DEFAULT '{}',
    "timeZone"          TEXT NOT NULL DEFAULT 'UTC',
    "scanHourLocal"     INTEGER NOT NULL DEFAULT 8,
    "scheduleEnabled"   BOOLEAN NOT NULL DEFAULT true,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "JobPreferences_userId_key" ON "JobPreferences" ("userId");

CREATE TABLE "Resume" (
    "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"      TEXT NOT NULL,
    "fileName"    TEXT NOT NULL,
    "mimeType"    TEXT NOT NULL,
    "sizeBytes"   INTEGER NOT NULL,
    "storageKey"  TEXT NOT NULL,
    "checksum"    TEXT NOT NULL,
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "parseError"  TEXT,
    "parsedAt"    TIMESTAMP(3),
    "isPrimary"   BOOLEAN NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"   TIMESTAMP(3),
    CONSTRAINT "Resume_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);
CREATE INDEX "Resume_userId_deletedAt_idx" ON "Resume" ("userId", "deletedAt");

CREATE TABLE "ProfileFact" (
    "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"       TEXT NOT NULL,
    "resumeId"     TEXT,
    "kind"         TEXT NOT NULL,
    "label"        TEXT NOT NULL,
    "detail"       TEXT,
    "keywords"     TEXT[] NOT NULL DEFAULT '{}',
    "startDate"    TEXT,
    "endDate"      TEXT,
    "organisation" TEXT,
    "role"         TEXT,
    "source"       TEXT NOT NULL DEFAULT 'manual',
    "verified"     BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt"   TIMESTAMP(3),
    "evidenceRef"  TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfileFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "ProfileFact_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume" ("id") ON DELETE SET NULL
);
CREATE INDEX "ProfileFact_userId_verified_idx" ON "ProfileFact" ("userId", "verified");
CREATE INDEX "ProfileFact_userId_kind_idx" ON "ProfileFact" ("userId", "kind");

-- ----------------------------------------------------------------- sources
CREATE TABLE "JobSource" (
    "id"                  TEXT PRIMARY KEY,
    "name"                TEXT NOT NULL,
    "family"              TEXT NOT NULL,
    "accessMethod"        TEXT NOT NULL,
    "enabled"             BOOLEAN NOT NULL DEFAULT true,
    "complianceNote"      TEXT NOT NULL,
    "reviewedAt"          TIMESTAMP(3),
    "healthState"         TEXT NOT NULL DEFAULT 'unknown',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt"       TIMESTAMP(3),
    "lastFailureAt"       TIMESTAMP(3),
    "lastError"           TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ScanRun" (
    "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"         TEXT NOT NULL,
    "trigger"        TEXT NOT NULL DEFAULT 'manual',
    "status"         TEXT NOT NULL DEFAULT 'queued',
    "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt"     TIMESTAMP(3),
    "jobsFound"      INTEGER NOT NULL DEFAULT 0,
    "jobsNew"        INTEGER NOT NULL DEFAULT 0,
    "jobsUpdated"    INTEGER NOT NULL DEFAULT 0,
    "errorSummary"   TEXT,
    "idempotencyKey" TEXT,
    CONSTRAINT "ScanRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);
CREATE INDEX "ScanRun_userId_startedAt_idx" ON "ScanRun" ("userId", "startedAt");
CREATE UNIQUE INDEX "ScanRun_idempotencyKey_key" ON "ScanRun" ("idempotencyKey");

CREATE TABLE "JobSourceRun" (
    "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "scanRunId"  TEXT NOT NULL,
    "sourceId"   TEXT NOT NULL,
    "status"     TEXT NOT NULL DEFAULT 'pending',
    "fetched"    INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "error"      TEXT,
    "note"       TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobSourceRun_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun" ("id") ON DELETE CASCADE,
    CONSTRAINT "JobSourceRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "JobSourceRun_scanRunId_sourceId_key" ON "JobSourceRun" ("scanRunId", "sourceId");

-- -------------------------------------------------------------------- jobs
CREATE TABLE "Job" (
    "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "dedupeKey"      TEXT NOT NULL,
    "title"          TEXT NOT NULL,
    "company"        TEXT NOT NULL,
    "companyLogoUrl" TEXT,
    "description"    TEXT NOT NULL,
    "url"            TEXT NOT NULL,
    "source"         TEXT NOT NULL,
    "externalId"     TEXT NOT NULL,
    "locationRaw"    TEXT,
    "city"           TEXT,
    "region"         TEXT,
    "countryCode"    TEXT,
    "remote"         BOOLEAN NOT NULL DEFAULT false,
    "workplace"      TEXT NOT NULL DEFAULT 'unknown',
    "employmentType" TEXT NOT NULL DEFAULT 'unknown',
    "seniority"      TEXT NOT NULL DEFAULT 'unknown',
    "salaryMin"      INTEGER,
    "salaryMax"      INTEGER,
    "salaryCurrency" TEXT,
    "salaryPeriod"   TEXT,
    "tags"           TEXT[] NOT NULL DEFAULT '{}',
    "status"         TEXT NOT NULL DEFAULT 'active',
    "freshness"      TEXT NOT NULL DEFAULT 'new',
    "postedAt"       TIMESTAMP(3),
    "expiresAt"      TIMESTAMP(3),
    "firstSeenAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job" ("dedupeKey");
CREATE INDEX "Job_status_freshness_idx" ON "Job" ("status", "freshness");
CREATE INDEX "Job_countryCode_idx" ON "Job" ("countryCode");
CREATE INDEX "Job_company_idx" ON "Job" ("company");
CREATE INDEX "Job_firstSeenAt_idx" ON "Job" ("firstSeenAt");

CREATE TABLE "JobSourceRecord" (
    "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "jobId"       TEXT NOT NULL,
    "sourceId"    TEXT NOT NULL,
    "externalId"  TEXT NOT NULL,
    "url"         TEXT NOT NULL,
    "sourceKey"   TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobSourceRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE,
    CONSTRAINT "JobSourceRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "JobSourceRecord_sourceKey_key" ON "JobSourceRecord" ("sourceKey");
CREATE UNIQUE INDEX "JobSourceRecord_sourceId_externalId_key" ON "JobSourceRecord" ("sourceId", "externalId");

CREATE TABLE "JobMatch" (
    "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"          TEXT NOT NULL,
    "jobId"           TEXT NOT NULL,
    "score"           INTEGER NOT NULL,
    "band"            TEXT NOT NULL,
    "excluded"        BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "scoringVersion"  TEXT NOT NULL,
    "profileVersion"  TEXT NOT NULL,
    "components"      JSONB NOT NULL,
    "evidence"        JSONB NOT NULL,
    "gaps"            JSONB NOT NULL,
    "usedSemantic"    BOOLEAN NOT NULL DEFAULT false,
    "userFeedback"    TEXT,
    "computedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobMatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "JobMatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "JobMatch_userId_jobId_key" ON "JobMatch" ("userId", "jobId");
CREATE INDEX "JobMatch_userId_score_idx" ON "JobMatch" ("userId", "score");

CREATE TABLE "UserJobState" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"    TEXT NOT NULL,
    "jobId"     TEXT NOT NULL,
    "saved"     BOOLEAN NOT NULL DEFAULT false,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "viewedAt"  TIMESTAMP(3),
    "feedback"  TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserJobState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "UserJobState_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "UserJobState_userId_jobId_key" ON "UserJobState" ("userId", "jobId");

-- --------------------------------------------------------------- documents
CREATE TABLE "GeneratedDocument" (
    "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"        TEXT NOT NULL,
    "jobId"         TEXT NOT NULL,
    "kind"          TEXT NOT NULL,
    "version"       INTEGER NOT NULL DEFAULT 1,
    "status"        TEXT NOT NULL DEFAULT 'draft',
    "content"       JSONB NOT NULL,
    "warnings"      TEXT[] NOT NULL DEFAULT '{}',
    "providerId"    TEXT,
    "model"         TEXT,
    "promptVersion" TEXT,
    "approvedAt"    TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GeneratedDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "GeneratedDocument_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "GeneratedDocument_userId_jobId_kind_version_key" ON "GeneratedDocument" ("userId", "jobId", "kind", "version");
CREATE INDEX "GeneratedDocument_userId_status_idx" ON "GeneratedDocument" ("userId", "status");

-- -------------------------------------------------------------- tracker
CREATE TABLE "Application" (
    "id"                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"                TEXT NOT NULL,
    "jobId"                 TEXT NOT NULL,
    "status"                TEXT NOT NULL DEFAULT 'saved',
    "resumeDocumentId"      TEXT,
    "coverLetterDocumentId" TEXT,
    "notes"                 TEXT,
    "nextActionAt"          TIMESTAMP(3),
    "appliedAt"             TIMESTAMP(3),
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt"            TIMESTAMP(3),
    CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "Application_userId_jobId_key" ON "Application" ("userId", "jobId");
CREATE INDEX "Application_userId_status_idx" ON "Application" ("userId", "status");

CREATE TABLE "ApplicationEvent" (
    "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "applicationId" TEXT NOT NULL,
    "type"          TEXT NOT NULL,
    "fromStatus"    TEXT,
    "toStatus"      TEXT,
    "message"       TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE
);
CREATE INDEX "ApplicationEvent_applicationId_createdAt_idx" ON "ApplicationEvent" ("applicationId", "createdAt");

-- ------------------------------------------------------- browser assistant
CREATE TABLE "BrowserSession" (
    "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"         TEXT NOT NULL,
    "jobId"          TEXT NOT NULL,
    "applicationUrl" TEXT NOT NULL,
    "adapterId"      TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'pending_consent',
    "pauseReason"    TEXT,
    "expiresAt"      TIMESTAMP(3) NOT NULL,
    "endedAt"        TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrowserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);
CREATE INDEX "BrowserSession_userId_status_idx" ON "BrowserSession" ("userId", "status");

CREATE TABLE "BrowserActionEvent" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "sessionId" TEXT NOT NULL,
    "action"    TEXT NOT NULL,
    "detail"    TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrowserActionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BrowserSession" ("id") ON DELETE CASCADE
);
CREATE INDEX "BrowserActionEvent_sessionId_createdAt_idx" ON "BrowserActionEvent" ("sessionId", "createdAt");

CREATE TABLE "AnswerBankEntry" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"    TEXT NOT NULL,
    "answers"   JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnswerBankEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "AnswerBankEntry_userId_key" ON "AnswerBankEntry" ("userId");

-- ------------------------------------------------------------- notifications
CREATE TABLE "Notification" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"    TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "body"      TEXT,
    "link"      TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt"    TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification" ("userId", "dedupeKey");
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification" ("userId", "readAt");

-- ------------------------------------------------------ consent and audit
CREATE TABLE "UserConsent" (
    "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"    TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "granted"   BOOLEAN NOT NULL,
    "version"   TEXT NOT NULL,
    "ip"        TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);
CREATE INDEX "UserConsent_userId_kind_createdAt_idx" ON "UserConsent" ("userId", "kind", "createdAt");

CREATE TABLE "AuditEvent" (
    "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"     TEXT,
    "action"     TEXT NOT NULL,
    "entityType" TEXT,
    "entityId"   TEXT,
    "metadata"   JSONB,
    "ip"         TEXT,
    "userAgent"  TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL
);
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent" ("userId", "createdAt");
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent" ("action", "createdAt");

-- -------------------------------------------------------------- work queue
CREATE TABLE "QueueJob" (
    "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "kind"           TEXT NOT NULL,
    "payload"        JSONB NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'queued',
    "attempts"       INTEGER NOT NULL DEFAULT 0,
    "maxAttempts"    INTEGER NOT NULL DEFAULT 3,
    "runAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt"       TIMESTAMP(3),
    "lockedBy"       TEXT,
    "lastError"      TEXT,
    "idempotencyKey" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "QueueJob_status_runAt_idx" ON "QueueJob" ("status", "runAt");
CREATE UNIQUE INDEX "QueueJob_idempotencyKey_key" ON "QueueJob" ("idempotencyKey");

CREATE TABLE "ScanSchedule" (
    "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"        TEXT NOT NULL,
    "enabled"       BOOLEAN NOT NULL DEFAULT true,
    "timeZone"      TEXT NOT NULL DEFAULT 'UTC',
    "hourLocal"     INTEGER NOT NULL DEFAULT 8,
    "lastRunAt"     TIMESTAMP(3),
    "nextRunAt"     TIMESTAMP(3),
    "lastScanRunId" TEXT,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ScanSchedule_userId_key" ON "ScanSchedule" ("userId");
