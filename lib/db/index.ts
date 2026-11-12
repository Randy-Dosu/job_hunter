import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema";
import { seedIfEmpty } from "./seed";

export type SqlValue = string | number | null;

const globalRef = globalThis as unknown as { __jobHunterDb?: DatabaseSync };

function open(): DatabaseSync {
  const file = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(process.cwd(), "data", "job-hunter.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA_SQL);
  seedIfEmpty(db);
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
