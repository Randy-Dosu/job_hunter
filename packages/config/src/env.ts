/**
 * Environment validation.
 *
 * The server refuses to start with an invalid configuration rather than failing
 * later in a request. Secrets are never logged: `describeEnv` prints only which
 * capabilities are configured.
 */

import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const optionalUrl = z.string().trim().url().optional();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Public origin of the web app; used for CORS and email links. */
  WEB_ORIGIN: z.string().trim().default('http://localhost:5173'),

  // --- database -------------------------------------------------------------
  DATABASE_URL: z
    .string()
    .trim()
    .min(1, 'DATABASE_URL is required')
    .default('postgresql://postgres:postgres@127.0.0.1:5432/postgres'),
  /**
   * Connection pool size. PGlite (the local dev database) serves a single
   * connection at a time, so `npm run dev` sets this to 1; a real Postgres in
   * production should use the default.
   */
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  PGLITE_DATA_DIR: z.string().trim().optional(),
  PGLITE_PORT: z.coerce.number().int().min(1).max(65535).default(5432),

  // --- auth -----------------------------------------------------------------
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .default('development-only-secret-change-me-please-1234'),
  AUTH_COOKIE_NAME: z.string().trim().default('jh_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),

  // --- storage --------------------------------------------------------------
  STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  STORAGE_LOCAL_DIR: z.string().trim().default('./data/storage'),
  SUPABASE_URL: optionalUrl,
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().trim().default('resumes'),

  // --- AI -------------------------------------------------------------------
  GROQ_API_KEY: z.string().trim().optional(),
  GROQ_MODEL: z.string().trim().optional(),
  GEMINI_API_KEY: z.string().trim().optional(),
  GEMINI_MODEL: z.string().trim().optional(),
  OPENROUTER_API_KEY: z.string().trim().optional(),
  OPENROUTER_MODEL: z.string().trim().optional(),
  HUGGINGFACE_API_KEY: z.string().trim().optional(),
  HUGGINGFACE_MODEL: z.string().trim().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),
  AI_MOCK: booleanString.default(false),

  // --- features -------------------------------------------------------------
  /** Browser assistance is off unless explicitly enabled here AND in code. */
  FEATURE_BROWSER_ASSISTANT: booleanString.default(false),
  FEATURE_NOTIFICATIONS: booleanString.default(true),
  /** Comma-separated admin emails (optional). */
  ADMIN_EMAILS: z.string().trim().optional(),

  // --- limits / observability ----------------------------------------------
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().min(1).max(1000).default(10),
  RATE_LIMIT_SCAN_PER_HOUR: z.coerce.number().int().min(1).max(100).default(6),
  RATE_LIMIT_AI_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(40),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  JOB_USER_AGENT: z
    .string()
    .trim()
    .default('JobHunterBot/0.1 (+https://github.com/Randy-Dosu/job_hunter)'),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

/**
 * Parse environment variables. In production we refuse to boot with the
 * development JWT secret: that would let anyone forge sessions.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new EnvError(`Invalid environment configuration — ${details}`);
  }

  if (
    result.data.NODE_ENV === 'production' &&
    result.data.JWT_SECRET === 'development-only-secret-change-me-please-1234'
  ) {
    throw new EnvError('JWT_SECRET must be set to a unique value in production');
  }

  if (result.data.STORAGE_DRIVER === 'supabase') {
    if (!result.data.SUPABASE_URL || !result.data.SUPABASE_SERVICE_ROLE_KEY) {
      throw new EnvError(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the supabase storage driver',
      );
    }
  }

  return result.data;
}

/** Non-secret summary for the startup log and /health details. */
export function describeEnv(env: Env): Record<string, string | boolean> {
  return {
    nodeEnv: env.NODE_ENV,
    storage: env.STORAGE_DRIVER,
    ai: {
      groq: Boolean(env.GROQ_API_KEY),
      gemini: Boolean(env.GEMINI_API_KEY),
      openrouter: Boolean(env.OPENROUTER_API_KEY),
      huggingface: Boolean(env.HUGGINGFACE_API_KEY),
      mock: env.AI_MOCK,
    },
    features: {
      browserAssistant: env.FEATURE_BROWSER_ASSISTANT,
      notifications: env.FEATURE_NOTIFICATIONS,
    },
  } as unknown as Record<string, string | boolean>;
}

export function adminEmails(env: Env): string[] {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}
