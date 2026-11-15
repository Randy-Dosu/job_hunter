import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * The connection URL lives here (not in schema.prisma). Migrations in this repo
 * are plain SQL applied by scripts/migrate.ts, so `prisma migrate deploy` is not
 * required at runtime — but `prisma generate` uses this config.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
  },
});
