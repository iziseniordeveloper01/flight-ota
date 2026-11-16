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
- Request schemas (`searchAirportsQuerySchema`, `searchFlightsSchema`, `offerIdSchema`) and response types/
  envelopes come from `@ota/contracts` — the web app validates with the same schemas. Don't define them here.
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
  - Supplier error → HTTP mapping is shared: `flights/supplier-errors.ts` (`callSupplier`). Exports the
    adapter + `FlightsService` for bookings.
- `insurance/` `INSURANCE_PROVIDER` token (`InsuranceProvider`: quote / bind). `INSURANCE_PROVIDER=demo` →
  `DemoInsuranceProvider` ("Travel Protection (Demo)", 3% of fare per passenger, min 5.00, policy `DEMO-<ref>`,
  `demo: true`). Opt-in only; price always recomputed server-side.
- `common/crypto/` `FieldEncryptionService`: AES-256-GCM, `v1:<iv>:<tag>:<ct>`, key `BOOKING_DATA_KEY`
  (base64, 32 bytes, required). The version prefix allows key rotation.
- `bookings/` guest checkout (all `/v1/bookings…`, `Cache-Control: no-store`, schemas from `@ota/contracts`):
  - `POST /bookings {offerId}` → re-prices (FlightsService.getOffer, 410 if gone) → DRAFT; returns the guest
    token ONCE (`meta.guestToken`) + `priceChanged`. Everything else needs header `X-Booking-Token`.
  - `GET /bookings/:id` (lazy expiry; CONFIRMING → `retrieveOrder` recovery, throttled 10s via Redis),
    `GET …/ancillaries`, `GET …/seat-maps` (Redis `bookings:{ancillaries,seat-maps}:v1:<id>`, TTL = offer expiry;
    ancillaries are served with `identityDocumentRequired` RESOLVED: supplier value, else international trip;
    the raw supplier null stays internal),
    `PUT …/details` (DRAFT only; replaces passengers + add-ons; 422 business rules; returns `meta.warnings`;
    a passenger may send `document: { keepExisting: true }` to keep the stored encrypted passport — none
    stored → 422 DOCUMENT_REQUIRED),
    `POST …/checkout` (fresh re-price of fare + add-ons + insurance, bypassing cache: total changed → stays
    DRAFT, amounts/snapshot updated, 422 PRICE_CHANGED {previousTotal,newTotal} — calling again accepts;
    add-on gone → 422 SERVICE_UNAVAILABLE {serviceIds}; else → PENDING_PAYMENT),
    `POST …/confirm-demo` (header `Idempotency-Key`; **dev/test only, 404 when NODE_ENV=production**).
  - Errors: 400 schema, 404 not found / bad token, 409 ILLEGAL_STATE / IDEMPOTENCY_CONFLICT, 410 expired,
    422 `{ code, message, issues? }` (AGE_CATEGORY_MISMATCH, NAME_TOO_LONG, DOCUMENT_REQUIRED, PRICE_CHANGED…),
    502/504 supplier. Codes: `BookingErrorCode` in contracts.

## Booking rules (apps/api/src/bookings)
- **State machine** (`booking-state.ts`): DRAFT→PENDING_PAYMENT|EXPIRED, PENDING_PAYMENT→CONFIRMING|EXPIRED,
  CONFIRMING→CONFIRMED|FAILED, CONFIRMED→CANCELLED. Change status ONLY via `BookingStore.transition()`
  (SELECT … FOR UPDATE + BookingEvent in one transaction). Writers of a booking lock the row first.
  `BookingEvent` is append-only and never contains PII.
- **Lazy expiry**: DRAFT/PENDING_PAYMENT read after `offerExpiresAt` → EXPIRED. CONFIRMING never expires.
- **Guest token**: 32 random bytes (base64url), only the sha256 is stored, compared with `timingSafeEqual`.
  Unknown id, malformed id, missing or wrong token → the same 404.
- **Booking view** also carries `airports` (name/city/country per IATA code on the itinerary, from the
  airports table) and `trip.international` (more than one country, or an unknown airport).
- **Encryption**: DOB and passport number are encrypted (`FieldEncryptionService`); responses show the
  document as `*****123` only. Responses are built by `toPublicBooking()` (allow-list: never supplierRef,
  supplierOfferId, supplierOrderId, token hash).
- **Prices**: fare from the supplier re-price; bags/seats from the supplier catalogue (client sends service ids
  + quantities only); insurance from the provider. Sums via `bookingTotals()` (decimal strings, Decimal(14,3) in DB).
- **Confirm**: one order attempt per booking — the PENDING_PAYMENT→CONFIRMING transition stores the
  Idempotency-Key; same key replays the stored result (FAILED replays from `failureCode` + event data),
  another key → 409. createOrder runs with a 130s timeout and WITHOUT the request's abort signal. Supplier
  TIMEOUT → stay CONFIRMING, 202; GET settles via `retrieveOrder` (never re-create). The supplier
  idempotency key is the booking id.
- **Stuck bookings**: CONFIRMING > 15 min → WARN (id + reference) on GET and in a 5-min sweep
  (`StuckBookingsMonitor`, Redis lock `bookings:lock:stuck-check` so one instance sweeps).
- e2e (`test/bookings.e2e-spec.ts`) uses `MockSupplier({ now })` with a movable clock; scenarios are listed in
  `packages/suppliers/AGENTS.md`. Test bookings are deleted in afterAll.

## Backlog
- Rate limiting on booking endpoints (create, token guessing, confirm).
- OTP (email/SMS) for "manage booking" by reference + email, instead of only the guest token.
- KMS / secret manager for `BOOKING_DATA_KEY` (+ rotation to `v2:` values).
- Real insurance partner behind `InsuranceProvider`.
- Admin exception queue for stuck CONFIRMING bookings + Duffel `order.created` / `order.creation_failed`
  webhook reconciliation.
- Expiry sweep job (expiry is lazy today).

## Commands (run from repo root)
- `pnpm --filter @ota/api dev` · `test` · `test:e2e` · `build`
- `pnpm db:up` starts Postgres 16 + Redis 7 (Docker)