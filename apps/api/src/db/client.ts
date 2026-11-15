/**
 * Prisma client factory.
 *
 * Uses the standard `pg` driver adapter, so the exact same code targets:
 *  - local PGlite (a real Postgres compiled to WASM) via the dev-db script,
 *  - Supabase PostgreSQL in production,
 *  - any Postgres connection string.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export type Database = PrismaClient;

export interface DatabaseOptions {
  connectionString: string;
  /** Pretty query logs in development only; never in production. */
  logQueries?: boolean | undefined;
  /** Connection pool size (PGlite handles one connection well). */
  maxConnections?: number | undefined;
}

export function createDatabase(options: DatabaseOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log: options.logQueries ? [{ emit: 'event', level: 'query' }] : ['warn', 'error'],
  });
}

/** Convert a Prisma unique-constraint error into a stable boolean check. */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2025'
  );
}
