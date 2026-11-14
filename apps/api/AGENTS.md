# @ota/api — agent notes

NestJS 12 backend for the flight OTA. ESM + Vitest, TypeScript strict, Node 24.

## Rules
- Every relative import ends in `.js` (ESM). Package imports have no extension.
- HTTP setup (helmet, CORS, `/v1` prefix, shutdown hooks) lives ONLY in `src/app.setup.ts` → `configureApp()`. main.ts and e2e tests both call it.
- Env vars are validated in `src/config/env.ts` (Zod). Add every new var there AND in root `.env.example`.
- Every external call (Redis, DB, supplier APIs) must have a timeout. Redis/DB: `src/common/with-timeout.ts`.
  Suppliers: pass `timeoutMs` (and optionally `signal`) in `CallOptions` — the adapter aborts the HTTP request itself
  (`withTimeout` only stops waiting, it can't cancel).
- Flight data only via the `SUPPLIER_ADAPTER` token (`SupplierAdapter` from `@ota/suppliers`) — never import
  `DuffelAdapter`/`MockSupplier` outside `flights/supplier.provider.ts`.
- Offers leave the API only through `toPublicOffer()` (strips `supplierRef`).
- Caching goes through `JsonCacheService` (`src/redis/json-cache.service.ts`): failures are a miss, never an error.
- Use Nest `Logger`, never `console.log`. Never log secrets or passenger documents.
- Raw SQL only via Prisma tagged templates (`prisma.$queryRaw\`...${value}\``) — never `$queryRawUnsafe` or string concatenation.
- Escape user input used in LIKE/ILIKE patterns with `escapeLike()` (`src/common/escape-like.ts`).

## Current modules
- `config/` env validation
- `redis/` global ioredis client (`REDIS_CLIENT` token), throttled error logging; `JsonCacheService`
  (get / set / setMany with 200ms timeout, fail-open)
- `health/` GET /v1/health → 200 ok / 503 degraded
- `common/` shared helpers: `withTimeout`, `escapeLike` (LIKE wildcard escaping), `ZodValidationPipe` (400 `{ message: 'Validation failed', issues }`)
- `prisma/` global Prisma client (`PRISMA` token) from `@ota/db`; health pings it with `SELECT 1`
- `airports/` GET /v1/airports?q=&limit= autocomplete. Zod-validated query; raw SQL with pg_trgm ranking
  (exact IATA → city/name prefix → large airport → trigram similarity); Redis cache-aside 24h,
  key prefix `airports:search:v1` (cache failures fall through to the DB). Data: `pnpm --filter @ota/db db:seed`.
  Extra search terms (old names, misspellings like "Dehli") are hand-maintained in
  `packages/db/prisma/data/airport-aliases.json` and merged into `keywords` by the seed — never edit
  `airports.json` by hand (it is regenerated from OurAirports). After changing aliases: re-seed, then
  delete Redis keys matching `airports:search:*` (not FLUSHALL).
- `flights/` supplier-backed search. `SUPPLIER=mock|duffel` (env.ts; `DUFFEL_ACCESS_TOKEN` required for duffel).
  - POST /v1/flights/search (Zod body) → `{ data, meta: { supplier, cached, count, currency, demo } }`, sorted by
    total (left in supplier order + warning if currencies are mixed). Cache `flights:search:v1:<sha256>` TTL
    min(10 min, earliest offer expiry); each offer at `flights:offer:v1:<id>` TTL until expiry (min 60s).
  - GET /v1/flights/offers/:id → re-prices via `adapter.price()` against the cached total → `{ data: PricedOffer }`.
    Missing/expired offer → 410; Redis down → 503.
  - SupplierError → HTTP: INVALID_REQUEST 400, OFFER_NOT_FOUND/OFFER_EXPIRED 410, TIMEOUT 504,
    UNAVAILABLE/UPSTREAM_ERROR 502. Responses are `Cache-Control: no-store`.
  - e2e overrides `SUPPLIER_ADAPTER` with `MockSupplier` (independent of .env).

## Commands (run from repo root)
- `pnpm --filter @ota/api dev` · `test` · `test:e2e` · `build`
- `pnpm db:up` starts Postgres 16 + Redis 7 (Docker)