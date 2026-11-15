/**
 * API server entrypoint.
 *
 * Composition happens here: environment -> database -> storage -> auth -> AI ->
 * Fastify. Nothing is imported by tests from this file, so the app remains fully
 * injectable.
 */

import { loadEnv, describeEnv, EnvError } from '@job-hunter/config';
import { createGateway } from '@job-hunter/ai-gateway';
import { buildApp, createBaseContext, type AppContext } from './app.js';
import { createDatabase } from './db/client.js';
import { createLogger } from './lib/logger.js';
import { createStorage } from './lib/storage.js';
import { AuthService } from './services/auth-service.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL });

  const db = createDatabase({
    connectionString: env.DATABASE_URL,
    logQueries: env.NODE_ENV === 'development' && env.LOG_LEVEL === 'debug',
  });

  const storage =
    env.STORAGE_DRIVER === 'supabase'
      ? createStorage({
          driver: 'supabase',
          url: env.SUPABASE_URL as string,
          serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY as string,
          bucket: env.SUPABASE_STORAGE_BUCKET,
        })
      : createStorage({ driver: 'local', directory: env.STORAGE_LOCAL_DIR });

  const ai = createGateway(
    {
      ...(env.GROQ_API_KEY ? { GROQ_API_KEY: env.GROQ_API_KEY } : {}),
      ...(env.GROQ_MODEL ? { GROQ_MODEL: env.GROQ_MODEL } : {}),
      ...(env.GEMINI_API_KEY ? { GEMINI_API_KEY: env.GEMINI_API_KEY } : {}),
      ...(env.GEMINI_MODEL ? { GEMINI_MODEL: env.GEMINI_MODEL } : {}),
      ...(env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY } : {}),
      ...(env.OPENROUTER_MODEL ? { OPENROUTER_MODEL: env.OPENROUTER_MODEL } : {}),
      ...(env.HUGGINGFACE_API_KEY ? { HUGGINGFACE_API_KEY: env.HUGGINGFACE_API_KEY } : {}),
      ...(env.HUGGINGFACE_MODEL ? { HUGGINGFACE_MODEL: env.HUGGINGFACE_MODEL } : {}),
      AI_TIMEOUT_MS: String(env.AI_TIMEOUT_MS),
      AI_MOCK: env.AI_MOCK ? 'true' : 'false',
    },
    {
      logger: {
        info: (message, meta) => logger.info(message, meta as Record<string, unknown>),
        warn: (message, meta) => logger.warn(message, meta as Record<string, unknown>),
      },
    },
  );

  const context: AppContext = {
    env,
    db,
    logger,
    storage,
    ai,
    auth: new AuthService({ db, logger, sessionTtlHours: env.SESSION_TTL_HOURS }),
    ...createBaseContext(env),
  };

  const app = await buildApp({ context });
  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  logger.info('api listening', {
    port: env.PORT,
    config: describeEnv(env),
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('shutting down', { signal });
    try {
      await app.close();
      await db.$disconnect();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

main().catch((error: unknown) => {
  if (error instanceof EnvError) {
    console.error(`[api] configuration error: ${error.message}`);
  } else {
    console.error('[api] failed to start:', error);
  }
  process.exit(1);
});
