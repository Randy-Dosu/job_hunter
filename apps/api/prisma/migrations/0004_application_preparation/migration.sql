-- Application preparation: the system does the writing, the user does the sending.
--
-- The product rule is unchanged: nothing here submits an application, and there
-- is still no column that could record a system submission. What changes is who
-- does the *preparation*. These columns let the system assemble a package on the
-- user's behalf (job match -> tailored documents -> review checklist) and let the
-- UI say plainly which packages it prepared and what still needs a human.

-- Per-user switch and limits. Off by default: preparing applications
-- automatically is opt-in, and a first run must not queue the whole feed.
ALTER TABLE "JobPreferences"
    ADD COLUMN IF NOT EXISTS "autoPrepareEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "autoPrepareMinScore" INTEGER NOT NULL DEFAULT 75,
    ADD COLUMN IF NOT EXISTS "autoPrepareDailyLimit" INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS "autoPrepareDocumentKinds" TEXT[] NOT NULL DEFAULT ARRAY['resume', 'cover_letter'];

-- Provenance and readiness of an application record.
ALTER TABLE "Application"
    ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS "preparedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "reviewChecklist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Existing rows predate the feature and were all user-created.
UPDATE "Application" SET "origin" = 'manual' WHERE "origin" IS NULL;

CREATE INDEX IF NOT EXISTS "Application_userId_origin_status_idx"
    ON "Application" ("userId", "origin", "status");

COMMENT ON COLUMN "Application"."origin" IS
    'manual | auto_prepare — how the record came to exist, so the UI never implies the user did work they did not.';
COMMENT ON COLUMN "Application"."reviewChecklist" IS
    'Reasons the package is not send-ready. Empty means ready for the user to review and submit.';
