-- Scan schedules belong to a user and must disappear with them.
-- Orphan rows from earlier local runs are removed first (no-op on a fresh database).
DELETE FROM "ScanSchedule" WHERE "userId" NOT IN (SELECT "id" FROM "User");
ALTER TABLE "ScanSchedule"
    ADD CONSTRAINT "ScanSchedule_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE;
