-- Whether a stored match rests on any verified candidate evidence.
--
-- The scoring engine already distinguishes "scored 33 because nothing about the
-- candidate is known" from "scored 33 after comparing real facts". Without a
-- column the API had to re-derive this from stored JSON on every read, which
-- made the UI's honesty depend on parsing internals. Persist the engine's own
-- verdict instead.
--
-- Existing rows predate the flag. They cannot be re-derived in SQL, so they are
-- marked scoreable (the conservative choice: an old score is still shown, and
-- the next scan or on-demand recompute refreshes the flag).
ALTER TABLE "JobMatch"
    ADD COLUMN IF NOT EXISTS "scoreable" BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN "JobMatch"."scoreable" IS
    'False when no verified candidate evidence existed in any judged dimension; the score must then be presented as "not enough information".';
