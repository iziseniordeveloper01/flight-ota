# flight-ota — agent notes

Turborepo + pnpm 10 workspaces, Node 24, ESM everywhere. Package-specific rules live in each package's own AGENTS.md.

## Layout
- `apps/api` — NestJS backend (`@ota/api`), see `apps/api/AGENTS.md`
- `apps/web` — Next.js App Router frontend (`@ota/web`), see `apps/web/AGENTS.md`
- `packages/contracts` — HTTP contract shared by api and web (`@ota/contracts`): request Zod schemas,
  public response types and envelopes
- `packages/db` — Prisma 7 schema, migrations, seed and generated client (`@ota/db`)
  - `prisma/data/airports.json` — generated from OurAirports by `pnpm --filter @ota/db data:airports` (committed)
  - `prisma/data/airport-aliases.json` — hand-maintained extra airport search terms
- `packages/suppliers` — flight supplier layer (`@ota/suppliers`), see `packages/suppliers/AGENTS.md`
- `docker-compose.yml` — local Postgres 16 + Redis 7 (`pnpm db:up` / `pnpm db:down`)

## Database
- After changing `schema.prisma`: `pnpm --filter @ota/db db:migrate` (migrates and regenerates the client).
- Seed (idempotent): `pnpm --filter @ota/db db:seed`.

## Supplier layer
- All flight data goes through `SupplierAdapter` (`@ota/suppliers`) and its normalized types. API/booking
  code never imports a supplier SDK or talks to a supplier API directly.
- New supplier (e.g. TBO) = new adapter in `@ota/suppliers` + a value in the `SUPPLIER` env enum + a case
  in `apps/api/src/flights/supplier.provider.ts`. Nothing else changes.
- Adapters map EVERY supplier failure to a `SupplierError` code; nothing else may escape them.
- Money is a decimal string + ISO currency (`{ amount: "123.45", currency: "USD" }`), never a float.
  Compare/sort with `compareMoney` (throws on currency mismatch).
- Segment/slice times are airport-local `YYYY-MM-DDTHH:mm:ss` without offset; use `durationMinutes` for elapsed time.
  Never pass them to `new Date(str)` / `toLocaleString` with a timezone (it shifts them): read the parts
  (web: `apps/web/src/lib/local-time.ts`).
- `FlightOffer.supplierRef` is server-only booking context; strip it (`toPublicOffer`) before any response.

## Contracts
- Request schemas and public types live in `@ota/contracts`; api and web both import from there. Never
  re-declare a request schema or response shape in an app.
- `@ota/contracts` depends only on `zod` and `@ota/suppliers` (domain types type-only, plus the pure
  `@ota/suppliers/money` subpath). Never `@ota/db`, a supplier SDK, or the adapters.
- Changing a schema changes both the API validation and the web form: run both apps' tests.

## Rules
- Secrets only in the root `.env` (git-ignored); document every variable in `.env.example`. Never print or commit `.env` values.
- From the root: `pnpm build` · `pnpm typecheck` · `pnpm test` · `pnpm dev` (api :4000 + web :3000).
