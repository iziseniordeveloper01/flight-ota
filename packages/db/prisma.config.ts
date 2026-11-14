import { resolve } from 'node:path';
import { config } from 'dotenv';
// Package subpath, not a relative file: it must match prisma's "exports" key ("./config"), so no .js.
import { defineConfig, env } from 'prisma/config';

// Prisma 7 does not load .env automatically. Our single .env lives at the monorepo root.
// The Prisma CLI is always run from packages/db (via pnpm --filter), so a cwd-relative path is safe.
config({ path: resolve(process.cwd(), '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});