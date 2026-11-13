# @ota/api — agent notes

NestJS 12 backend for the flight OTA. ESM + Vitest, TypeScript strict, Node 24.

## Rules
- Every relative import ends in `.js` (ESM). Package imports have no extension.
- HTTP setup (helmet, CORS, `/v1` prefix, shutdown hooks) lives ONLY in `src/app.setup.ts` → `configureApp()`. main.ts and e2e tests both call it.
- Env vars are validated in `src/config/env.ts` (Zod). Add every new var there AND in root `.env.example`.
- Every external call (Redis, DB, supplier APIs) must have a timeout — use `src/common/with-timeout.ts`. Supplier HTTP calls must also pass an AbortSignal.
- Use Nest `Logger`, never `console.log`. Never log secrets or passenger documents.

## Current modules
- `config/` env validation
- `redis/` global ioredis client (`REDIS_CLIENT` token), throttled error logging
- `health/` GET /v1/health → 200 ok / 503 degraded
- `common/` shared helpers (withTimeout)

## Commands (run from repo root)
- `pnpm --filter @ota/api dev` · `test` · `test:e2e` · `build`
- `pnpm db:up` starts Postgres 16 + Redis 7 (Docker)