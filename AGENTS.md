# flight-ota — agent notes

Turborepo + pnpm 10 workspaces, Node 24, ESM everywhere. Package-specific rules live in each package's own AGENTS.md.

## Layout
- `apps/api` — NestJS backend (`@ota/api`), see `apps/api/AGENTS.md`
- `packages/db` — Prisma 7 schema, migrations, seed and generated client (`@ota/db`)
  - `prisma/data/airports.json` — generated from OurAirports by `pnpm --filter @ota/db data:airports` (committed)
  - `prisma/data/airport-aliases.json` — hand-maintained extra airport search terms
- `docker-compose.yml` — local Postgres 16 + Redis 7 (`pnpm db:up` / `pnpm db:down`)

## Database
- After changing `schema.prisma`: `pnpm --filter @ota/db db:migrate` (migrates and regenerates the client).
- Seed (idempotent): `pnpm --filter @ota/db db:seed`.

## Rules
- Secrets only in the root `.env` (git-ignored); document every variable in `.env.example`. Never print or commit `.env` values.
- From the root: `pnpm build` · `pnpm typecheck` · `pnpm test`.
