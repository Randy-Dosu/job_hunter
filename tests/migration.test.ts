import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "./sqlite-shim";

/**
 * A database created by an older build must keep working: the app adds the new
 * columns at open time. This test pins that behaviour, because a missing column
 * only shows up at runtime as "no such column".
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-hunter-migrate-"));
const file = path.join(dir, "legacy.db");

const globalRef = globalThis as unknown as { __jobHunterDb?: unknown };

beforeEach(() => {
  fs.rmSync(file, { force: true });
  vi.resetModules();
  delete globalRef.__jobHunterDb;
  process.env.DATABASE_PATH = file;
  process.env.SOURCE_FIXTURE_FALLBACK = "true";
  process.env.ADMIN_EMAILS = "owner@example.com";

  const legacy = new DatabaseSync(file);
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE applications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      package_id TEXT,
      status TEXT NOT NULL DEFAULT 'preparing',
      submitted_at TEXT,
      confirmation_reference TEXT,
      last_updated_at TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '',
      next_action_at TEXT
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      read_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  legacy
    .prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run("12121212-1212-4212-8212-121212121212", "owner@example.com", "Owner", "x", new Date().toISOString());
  legacy.close();
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("additive migrations", () => {
  it("upgrades a legacy database in place", async () => {
    const db = await import("@/lib/db");

    const userColumns = db.all<{ name: string }>("PRAGMA table_info(users)").map((row) => row.name);
    expect(userColumns).toContain("role");

    const notificationColumns = db.all<{ name: string }>("PRAGMA table_info(notifications)").map((row) => row.name);
    expect(notificationColumns).toEqual(
      expect.arrayContaining(["channel", "delivery_status", "delivery_error", "delivered_at", "dedupe_key"]),
    );

    const applicationColumns = db.all<{ name: string }>("PRAGMA table_info(applications)").map((row) => row.name);
    expect(applicationColumns).toContain("reminder_sent_at");

    const dedupeIndex = db.all<{ name: string }>("PRAGMA index_list(notifications)").map((row) => row.name);
    expect(dedupeIndex).toContain("idx_notifications_dedupe");

    // Administrators come from ADMIN_EMAILS; existing accounts are promoted on open.
    const owner = db.get<{ role: string }>("SELECT role FROM users WHERE email = ?", "owner@example.com");
    expect(owner?.role).toBe("admin");

    // New tables exist and the manual-import source was registered.
    const variants = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'resume_variants'");
    expect(variants).toHaveLength(1);
    const manual = db.get<{ slug: string }>("SELECT slug FROM job_sources WHERE slug = 'manual'");
    expect(manual?.slug).toBe("manual");
  });

  it("is idempotent across repeated opens", async () => {
    const first = await import("@/lib/db");
    first.all("SELECT 1 AS ok");
    delete globalRef.__jobHunterDb;
    vi.resetModules();
    const second = await import("@/lib/db");
    expect(() => second.all("SELECT id FROM notifications WHERE dedupe_key IS NULL")).not.toThrow();
    const count = second.all<{ name: string }>("PRAGMA table_info(notifications)").filter((row) => row.name === "dedupe_key");
    expect(count).toHaveLength(1);
  });
});
