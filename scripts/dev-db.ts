/**
 * Local development database.
 *
 * Starts PGlite (PostgreSQL compiled to WebAssembly) and exposes it on the
 * Postgres wire protocol so any Postgres client — psql, Prisma, the API, the
 * worker — connects exactly as it would to Supabase. Zero native builds, zero
 * external services, and the same SQL runs in production.
 *
 * Usage:
 *   npm run db:up            # start and keep running (dev)
 *   PGLITE_SEED=1 npm run db:up
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const dataDir = resolve(process.env.PGLITE_DATA_DIR ?? './data/pglite');
const port = Number.parseInt(process.env.PGLITE_PORT ?? '5432', 10);

mkdirSync(dirname(dataDir), { recursive: true });
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const db = await PGlite.create({ dataDir });
const server = new PGLiteSocketServer({ db, port, host: '0.0.0.0' });

await server.start();
console.log(
  `[dev-db] PGlite listening on postgresql://postgres:postgres@127.0.0.1:${port}/postgres (data: ${dataDir})`,
);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[dev-db] stopping…');
  try {
    await server.stop();
    await db.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
