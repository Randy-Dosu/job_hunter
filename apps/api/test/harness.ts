/**
 * API integration harness.
 *
 * Starts an isolated PGlite instance on a random port, applies the real
 * migrations, and boots the real Fastify app with injected doubles for AI and
 * storage. Nothing is mocked at the HTTP layer: requests go through routing,
 * auth, validation, services and Prisma exactly as in production.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { loadEnv, type Env } from '@job-hunter/config';
import { AIGateway, MockProvider, defaultMockResponder } from '@job-hunter/ai-gateway';
import { buildApp, createBaseContext, type AppContext } from '../src/app.js';
import { createDatabase, type Database } from '../src/db/client.js';
import { createLogger } from '../src/lib/logger.js';
import { createStorage, type FileStorage } from '../src/lib/storage.js';
import { AuthService } from '../src/services/auth-service.js';

const MIGRATIONS_DIR = join(process.cwd(), 'apps/api/prisma/migrations');

export interface TestHarness {
  app: FastifyInstance;
  db: Database;
  context: AppContext;
  storageDir: string;
  close: () => Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Apply every migration in order, exactly like scripts/migrate.ts. */
async function migrate(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _job_hunter_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const directories = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const name of directories) {
      const sql = readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _job_hunter_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

export function createTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/postgres',
      JWT_SECRET: 'test-secret-value-that-is-long-enough-32',
      LOG_LEVEL: 'error',
      AI_MOCK: 'true',
      STORAGE_DRIVER: 'local',
      FEATURE_BROWSER_ASSISTANT: 'false',
      RATE_LIMIT_AUTH_PER_MIN: '100',
      RATE_LIMIT_SCAN_PER_HOUR: '100',
      RATE_LIMIT_AI_PER_HOUR: '100',
      ...(overrides as Record<string, string>),
    } as NodeJS.ProcessEnv),
    ...overrides,
  } as Env;
}

export interface HarnessOptions {
  env?: Partial<Env>;
  /** Replace the AI gateway (defaults to a deterministic mock). */
  ai?: AIGateway;
  /** Fixed clock for deterministic assertions. */
  now?: () => Date;
}

export async function startHarness(options: HarnessOptions = {}): Promise<TestHarness> {
  const dataDir = mkdtempSync(join(tmpdir(), 'jh-api-db-'));
  const storageDir = mkdtempSync(join(tmpdir(), 'jh-api-files-'));
  const port = await freePort();

  const pglite = await PGlite.create({ dataDir });
  const socket = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1' });
  await socket.start();

  const connectionString = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  await migrate(connectionString);

  const db = createDatabase({ connectionString, maxConnections: 1 });
  const env = createTestEnv(options.env);
  // Test logs are written to stderr at 'error' level only; tests assert on
  // HTTP responses, not on log output.
  const logger = createLogger({ level: 'error' });
  const storage: FileStorage = createStorage({ driver: 'local', directory: storageDir });

  const context: AppContext = {
    env,
    db,
    logger,
    storage,
    ai: options.ai ?? createMockGateway(),
    auth: new AuthService({ db, logger, sessionTtlHours: 24 }),
    ...createBaseContext(env),
    ...(options.now ? { now: options.now } : {}),
  };

  const app = await buildApp({ context });
  await app.ready();

  return {
    app,
    db,
    context,
    storageDir,
    close: async () => {
      await app.close();
      await db.$disconnect().catch(() => undefined);
      await socket.stop().catch(() => undefined);
      await pglite.close().catch(() => undefined);
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

/**
 * Deterministic AI gateway: a real AIGateway backed by the mock provider, so
 * fallback ordering, JSON extraction and schema validation are all exercised.
 */
export function createMockGateway(): AIGateway {
  return new AIGateway({
    providers: [new MockProvider(defaultMockResponder)],
    deadlineMs: 5_000,
  });
}

/** Cookie header helper for authenticated requests. */
export function sessionCookie(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error('No Set-Cookie header in response');
  return value.split(';')[0] as string;
}
