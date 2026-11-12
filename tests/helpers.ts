import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Point the data layer at a throwaway SQLite file for each test module. */
export function useTempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-hunter-test-"));
  process.env.DATABASE_PATH = path.join(dir, "test.db");
  process.env.SOURCE_FIXTURE_FALLBACK = "true";
  delete process.env.LLM_API_KEY;
  return {
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const DEMO_USER_EMAIL = "demo@jobhunter.app";
