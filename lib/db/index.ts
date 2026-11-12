import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema";
import { seedIfEmpty } from "./seed";

export type SqlValue = string | number | null;

const globalRef = globalThis as unknown as { __jobHunterDb?: DatabaseSync };

/**
 * Additive migrations for databases created before a column existed.
 * `CREATE TABLE IF NOT EXISTS` never alters an existing table, so new columns
 * have to be added explicitly. Kept declarative and idempotent.
 */
const ADDED_COLUMNS: Record<string, { name: string; ddl: string }[]> = {
  users: [{ name: "role", ddl: "role TEXT NOT NULL DEFAULT 'user'" }],
  applications: [{ name: "reminder_sent_at", ddl: "reminder_sent_at TEXT" }],
  notifications: [
    { name: "channel", ddl: "channel TEXT NOT NULL DEFAULT 'in_app'" },
    { name: "delivery_status", ddl: "delivery_status TEXT NOT NULL DEFAULT 'stored'" },
    { name: "delivery_error", ddl: "delivery_error TEXT NOT NULL DEFAULT ''" },
    { name: "delivered_at", ddl: "delivered_at TEXT" },
    { name: "dedupe_key", ddl: "dedupe_key TEXT" },
  ],
};

function migrate(db: DatabaseSync) {
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name),
    );
    for (const column of columns) {
      if (!existing.has(column.name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column.ddl}`);
    }
  }
  // Indexes that depend on migrated columns are created after the columns exist.
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL",
  );

  // The demo account owns source governance so the admin console is reachable offline.
  db.prepare("UPDATE users SET role = 'admin' WHERE email = ? AND role <> 'admin'").run("demo@jobhunter.app");

}

/** Governance row for user-supplied links (FR-017). Runs after seeding on every open. */
function ensureManualSource(db: DatabaseSync) {
  // Governance row for user-supplied links (FR-017), idempotent by slug.
  const manual = db.prepare("SELECT id FROM job_sources WHERE slug = 'manual'").get() as { id: string } | undefined;
  if (!manual) {
    db.prepare(
      `INSERT INTO job_sources (id, name, slug, source_type, access_method, terms_url, terms_reviewed_at, enabled,
        rate_limit_config_json, supported_markets, notes)
       VALUES (?, 'Manual import', 'manual', 'user_supplied', ?, ?, ?, 1, ?, 'Any', ?)`,
    ).run(
      crypto.randomUUID(),
      "Single URL pasted by the user",
      "https://jobhunter.app/terms/manual-import",
      new Date().toISOString(),
      JSON.stringify({ maxRequestsPerDay: 20, timeoutMs: 8000 }),
      "User-supplied link. Fetched once with no login or bypass. The user is responsible for that site's terms.",
    );
  }
}

function open(): DatabaseSync {
  const file = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(process.cwd(), "data", "job-hunter.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA_SQL);
  migrate(db);
  seedIfEmpty(db);
  ensureManualSource(db);
  return db;
}

/** Process-wide (and HMR-safe) database handle. */
export function getDb(): DatabaseSync {
  if (!globalRef.__jobHunterDb) globalRef.__jobHunterDb = open();
  return globalRef.__jobHunterDb;
}

/** node:sqlite returns null-prototype objects; copy them so they can cross the server/client boundary. */
function plain<T>(row: unknown): T {
  return { ...(row as object) } as T;
}

export function all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[] {
  const rows = getDb().prepare(sql).all(...params) as unknown[];
  return rows.map((row) => plain<T>(row));
}

export function get<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T | undefined {
  const row = getDb().prepare(sql).get(...params);
  return row === undefined ? undefined : plain<T>(row);
}

export function run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
  const res = getDb().prepare(sql).run(...params);
  return { changes: Number(res.changes), lastInsertRowid: Number(res.lastInsertRowid) };
}

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export const nowIso = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Insert helper that keeps SQL readable. */
export function insert(table: string, row: Record<string, SqlValue>) {
  const keys = Object.keys(row);
  const placeholders = keys.map(() => "?").join(", ");
  return run(
    `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`,
    ...keys.map((k) => row[k]),
  );
}

export function update(table: string, id: string, row: Record<string, SqlValue>) {
  const keys = Object.keys(row);
  if (!keys.length) return;
  run(
    `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
    ...keys.map((k) => row[k]),
    id,
  );
}

export function bool(value: unknown): number {
  return value ? 1 : 0;
}
