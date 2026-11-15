/**
 * Migration runner.
 *
 * Applies each prisma/migrations/<dir>/migration.sql in filename order inside a
 * transaction per file and records what has been applied in
 * `_job_hunter_migrations`. Idempotent: safe to run on every deploy.
 *
 *   npm run db:migrate
 *   npm run db:migrate -- --reset   # drop and re-apply (development only)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'apps/api/prisma/migrations');
const reset = process.argv.includes('--reset');
const connectionString =
  process.env.DATABASE_URL ??
  `postgresql://postgres:postgres@127.0.0.1:${process.env.PGLITE_PORT ?? '5432'}/postgres`;

const client = new pg.Client({ connectionString });

/**
 * PGlite's socket server serves one connection at a time and can drop a
 * connection that arrives while it is still switching between clients. That is
 * a transient transport condition, not a migration failure, so connecting is
 * retried briefly before giving up.
 */
async function connectWithRetry(attempts = 5, delayMs = 400): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await client.connect();
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.warn(
        `[migrate] connect attempt ${attempt} failed (${
          error instanceof Error ? error.message : String(error)
        }), retrying…`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}

async function main(): Promise<void> {
  await connectWithRetry();

  if (reset) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to reset the database in production');
    }
    console.log('[migrate] dropping schema public…');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS _job_hunter_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = new Set(
    (await client.query<{ name: string }>('SELECT name FROM _job_hunter_migrations')).rows.map(
      (row) => row.name,
    ),
  );

  const directories = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let count = 0;
  for (const directory of directories) {
    if (applied.has(directory)) continue;
    const file = join(MIGRATIONS_DIR, directory, 'migration.sql');
    const sql = readFileSync(file, 'utf8');
    console.log(`[migrate] applying ${directory}…`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _job_hunter_migrations (name) VALUES ($1)', [directory]);
      await client.query('COMMIT');
      count += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(
        `Migration ${directory} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(
    count === 0 ? '[migrate] database is up to date' : `[migrate] applied ${count} migration(s)`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('[migrate] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void client.end();
  });
