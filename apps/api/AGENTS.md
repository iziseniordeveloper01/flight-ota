# @ota/api — agent notes

NestJS 12 backend for the flight OTA. ESM + Vitest, TypeScript strict, Node 24.

## Rules
- Every relative import ends in `.js` (ESM). Package imports have no extension.
- HTTP setup (helmet, CORS, `/v1` prefix, shutdown hooks) lives ONLY in `src/app.setup.ts` → `configureApp()`. main.ts and e2e tests both call it.
  `rawBody: true` is a NestFactory option (webhook signatures need the exact bytes): main.ts and
  `test/test-app.ts` both pass it.
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
  (get / set / setMany with 200ms timeout, fail-open; `getRequired` for Redis-only records such as the
  offer a customer saw: 1s timeout, throws on failure so an outage is a 503, never a fake "gone")
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
    min(10 min, earliest offer expiry); each offer at `flights:offer:v2:<id>` as `{ offer, search }` (the
    SearchRequest is server-only, kept beside the offer so it never leaks) TTL until expiry (min 60s).
  - `FlightsService.reshop(id)`: fresh search with the cached offer's request (skips the search cache read,
    writes the new results), picks the offer with the same `offerFingerprint()` (same total preferred, else
    cheapest) → `PricedOffer` vs the cached total. No match → 410 FARE_NO_LONGER_AVAILABLE.
  - GET /v1/flights/offers/:id → re-prices via `adapter.price()` against the cached total → `{ data: PricedOffer }`.
    Missing/expired offer → 410; Redis down → 503.
  - SupplierError → HTTP: INVALID_REQUEST 400, OFFER_NOT_FOUND/OFFER_EXPIRED 410 `{ code:
    'FARE_NO_LONGER_AVAILABLE', message: 'This fare is no longer available. Please search again.' }`
    (`fareNoLongerAvailable()`, also for a missing cached offer), TIMEOUT 504,
    UNAVAILABLE/UPSTREAM_ERROR 502. Responses are `Cache-Control: no-store`.
  - e2e overrides `SUPPLIER_ADAPTER` with `MockSupplier` (independent of .env).
  - Supplier error → HTTP mapping is shared: `flights/supplier-errors.ts` (`callSupplier`). Exports the
    adapter + `FlightsService` for bookings.
- `insurance/` `INSURANCE_PROVIDER` token (`InsuranceProvider`: quote / bind). `INSURANCE_PROVIDER=demo` →
  `DemoInsuranceProvider` ("Travel Protection (Demo)", 3% of fare per passenger, min 5.00, policy `DEMO-<ref>`,
  `demo: true`). Opt-in only; price always recomputed server-side. Quoted on the CHARGE fare (INR).
- `pricing/` supplier Money → charge Money (`CHARGE_CURRENCY`, INR).
  - `pricing.ts` (pure, BigInt rationals): `convert()` = amount × rate × (1 + `FX_BUFFER_PERCENT`) ×
    (1 + `MARKUP_PERCENT`) + `MARKUP_FIXED_MINOR`; cross-currency rounded UP to the whole rupee, same
    currency passed through exactly (paise kept). `priceQuote(fx)`: `line()` (bags/seats, no markup) and
    `fare()` (with markup, reports the markup amount).
  - `FxService`: Redis `fx:rate:v1:<source>:<base>:<quote>` (6h) → `FX_RATE_SOURCE` (Frankfurter v2
    `GET /v2/rate/{base}/{quote}`, 5s timeout, each fetch stored in `fx_rates`) → last stored rate of
    that source if < 48h → 503 `FX_UNAVAILABLE`. One fetch per pair in flight per process.
  - `PricingService.publicOffers()` adds `displayPrice` and sorts by it — search and re-price use it.
- `payments/` (all money in): `PAYMENT_PROVIDER` token (`payment-provider.module.ts`, shared with
  bookings): `RazorpayProvider` (native fetch + Basic auth, 15s timeout, every failure →
  `PaymentProviderError`), `FakePaymentProvider` (`PAYMENT_PROVIDER=fake`, NODE_ENV=test only; same
  signature scheme), `DemoPaymentProvider` (no gateway: confirm-demo).
  - `POST /bookings/:id/payment-order` (guest token): PENDING_PAYMENT, charge snapshot present (else 409),
    offer valid ≥ 2 min (else 410 `PAYMENT_WINDOW_CLOSED`), ≤ 10 attempts (429). New provider order per
    attempt (receipt `<reference>-<attempt>`, notes = bookingId + reference only), `payments` row CREATED;
    returns checkout options incl. `timeoutSeconds` (checkout closes 60s before the offer expires).
  - `POST /bookings/:id/payment-verify` → 202 `{ status }`: the client's order id must be OUR latest
    attempt; HMAC over our stored order id; payment re-fetched (same order, amount, currency; authorized →
    capture) → `markPaid()`.
  - `markPaid(orderId, payment, source)`: idempotent, booking row lock. PENDING_PAYMENT + nothing captured
    → payment CAPTURED, booking PAID, ticketing job. Otherwise (EXPIRED/FAILED/CANCELLED booking, or a
    second captured payment) → recorded, then a full refund (EXPIRED/FAILED → REFUND_PENDING; other
    bookings keep their status). Amount/currency mismatch → nothing changes, logged.
  - `POST /v1/webhooks/razorpay`: HMAC (webhook secret) over the RAW body → 401 if wrong;
    `x-razorpay-event-id` required; `webhook_events` row (ids/amount/status/error code only — no payload)
    is the dedupe; processing runs in the `payments-webhooks` queue (reply < 5s). Handled:
    `payment.captured`/`order.paid` → markPaid, `payment.failed` → attempt FAILED (code only),
    `refund.processed`/`refund.failed` → refund + booking. Anything else → 200, ignored.
  - Refunds (`RefundsService`): DB part in one transaction (Refund PENDING, payment REFUND_PENDING, booking
    REFUND_PENDING); provider call in the `refunds` queue with `X-Refund-Idempotency` = our refund id.
    processed → REFUNDED (booking too once no refund is pending); failed → REFUND_FAILED + ERROR log.
  - `ReconciliationService` (maintenance job, every 5 min): open attempts < 3 days → `fetchOrderPayments`
    (captured → markPaid), PENDING refunds → poll / re-send, PAID bookings > 2 min → ticketing re-enqueued,
    FAILED bookings still holding money → refund. Webhooks never reach localhost: this + verify cover it.
- `queues/` BullMQ (`@nestjs/bullmq`, own connections to `REDIS_URL`, key prefix `QUEUE_PREFIX`). Queues:
  `ticketing`, `payments-webhooks`, `refunds`, `emails`, `maintenance`. Jobs are added ONLY through
  `JobQueue` (job ids, retries, retention): ids only in payloads (no PII), no ":" in job ids, every job has
  `removeOnComplete`/`removeOnFail`. `addFresh()` removes a retained completed/failed job with the same id
  before re-adding (BullMQ silently ignores `add()` while one exists). createOrder is never retried
  automatically (attempts 1); refunds, webhooks and emails retry 5× with exponential backoff.
  Processors are `autorun: false` and start only when `WORKERS_ENABLED=true` (dev default). **Production
  runs the workers in a separate worker process** (same image, `WORKERS_ENABLED=true`; API instances
  `false`). The maintenance schedules are BullMQ job schedulers (one execution per tick, no lock needed).
- `email/` `EmailService` (nodemailer SMTP: `SMTP_*`; Mailpit locally, SES SMTP in production; tests
  override `MAIL_TRANSPORT`). Templates in `templates.ts`, every string in `email-strings.ts`: booking
  confirmed, refund initiated (reason-specific), refund completed. HTML (inline styles) + text; names are
  the only personal data (no DOB, documents, phone). Jobs carry `{ kind, bookingId, refundId? }`;
  job id `email-<kind>-<id>` so each email is sent once.
- `common/crypto/` `FieldEncryptionService`: AES-256-GCM, `v1:<iv>:<tag>:<ct>`, key `BOOKING_DATA_KEY`
  (base64, 32 bytes, required). The version prefix allows key rotation.
- `bookings/` guest checkout (all `/v1/bookings…`, `Cache-Control: no-store`, schemas from `@ota/contracts`):
  - `POST /bookings {offerId}` → re-shops (`FlightsService.reshop`: the draft gets its OWN fresh supplier
    offer — one supplier order per search — 410 FARE_NO_LONGER_AVAILABLE if gone) → DRAFT; returns the guest
    token ONCE (`meta.guestToken`) + `priceChanged`/`previousTotal` (fresh total ≠ what the customer saw).
    Everything else needs header `X-Booking-Token`.
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
    `POST …/confirm-demo` (header `Idempotency-Key`; **only with PAYMENT_PROVIDER=demo — 404 otherwise
    and when NODE_ENV=production**; PENDING_PAYMENT → PAID, then ticketing inline: 200 / 202).
  - Every booking response has `price` (supplier: fare, ancillaries, total in its currency), `displayPrice`
    (INR: fare, baggage, seats, insurance, total — what is charged), `offer.displayPrice`, ancillary
    `displayAmount`, and `payment: { provider, refund }`. Ancillaries/seat maps carry `displayPrice` per
    bag/seat at the booking's own FX snapshot (taken at creation, refreshed at checkout). PRICE_CHANGED
    (checkout and confirm) reports `previousTotal`/`newTotal` in INR.
  - Errors: 400 schema, 404 not found / bad token, 409 ILLEGAL_STATE / IDEMPOTENCY_CONFLICT, 410
    BOOKING_EXPIRED (booking hold passed) / FARE_NO_LONGER_AVAILABLE (fare gone, incl. supplier OFFER_EXPIRED
    at confirm → booking FAILED),
    422 `{ code, message, issues? }` (AGE_CATEGORY_MISMATCH, NAME_TOO_LONG, DOCUMENT_REQUIRED, PRICE_CHANGED…),
    502/504 supplier. Codes: `BookingErrorCode` in contracts.

## Booking rules (apps/api/src/bookings)
- **State machine** (`booking-state.ts`): DRAFT→PENDING_PAYMENT|EXPIRED, PENDING_PAYMENT→PAID|EXPIRED,
  PAID→CONFIRMING, CONFIRMING→CONFIRMED|FAILED, CONFIRMED→CANCELLED, FAILED→REFUND_PENDING,
  EXPIRED→REFUND_PENDING (late payment), REFUND_PENDING→REFUNDED. REFUND_PENDING is entered only with
  captured money to give back (a demo FAILED stays FAILED). Change status ONLY via `BookingStore.transition()`
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
  + quantities only); insurance from the provider. Supplier side via `supplierTotals()` (fare + bags/seats —
  `total_amount`, what the airline charges); charge side via `chargeTotals()` (`charge_*` columns, INR, each
  line converted on its own so the total is their sum) + the FX snapshot (`fx_rate`, `fx_buffer_percent`,
  `fx_source`, `fx_fetched_at`). Decimal strings, Decimal(14,3) in DB. Rows from before payments existed have
  no charge columns: they show supplier amounts and can't be paid (409).
- **Ticketing** (`TicketingService`, run by the `ticketing` worker, or inline by confirm-demo): only a PAID
  booking is ordered — the PAID→CONFIRMING transition is the lock; a CONFIRMING one is only recovered with
  `retrieveOrder` (also a stalled/re-run job); anything else is a no-op. createOrder: 130s timeout, no
  request abort signal, `expectedTotal` in the SUPPLIER currency, idempotency key = booking id. TIMEOUT →
  stays CONFIRMING + delayed `recover` jobs (+1/2/5/10/20 min). PRICE_CHANGED / fare gone / upstream error →
  FAILED → (money captured) `refund-booking` job → REFUND_PENDING + "refund initiated" email. CONFIRMED →
  insurance bound + confirmation email. confirm-demo keeps its Idempotency-Key replay (same key → same
  result, other key → 409).
- **Stuck bookings**: CONFIRMING > 15 min → WARN (id + reference) on GET and in the 5-min `stuck-bookings`
  maintenance job (`StuckBookingsMonitor.sweep()`).
- e2e apps are built with `test/test-app.ts` `createTestApp()`: supplier, FX source (`FixedRateSource`, own
  source name), payment provider, mail transport and queue settings are overridden — no network. Defaults
  (vitest.config.e2e.ts env): PAYMENT_PROVIDER=demo, WORKERS_ENABLED=false, QUEUE_PREFIX=e2e.
  `test/bookings.e2e-spec.ts` uses `MockSupplier({ now })` with a movable clock (scenarios in
  `packages/suppliers/AGENTS.md`); `test/payments.e2e-spec.ts` runs `FakePaymentProvider` with workers ON on
  a random queue prefix (obliterated in afterAll). Test bookings are deleted with `deleteBookings()`
  (refunds → payments → bookings: payments are Restrict-linked, never cascaded).

## Razorpay locally
- Test keys only (`rzp_test_…`; live keys are refused unless NODE_ENV=production). Checkout: test cards
  (e.g. 4100 2800 0000 1007 success, 4100 2800 0006 0003 declined; any future expiry/CVV, OTP of 4–10
  digits), netbanking mock page with Success/Failure, UPI `success@razorpay` / `failure@razorpay` where
  the account offers UPI. Razorpay rejects some "fake-looking" phone numbers (9876543210); 9000090000 works.
- Webhooks can't reach localhost; verify + the 5-min reconciliation settle everything without them.
  Optional public tunnel for webhook testing (Razorpay recommends **zrok**; `ngrok.io`/`loca.lt` are
  blacklisted): `zrok share public http://localhost:4000` → in the Razorpay Dashboard (Test mode) add a
  webhook `https://<share>.share.zrok.io/v1/webhooks/razorpay` with events payment.captured, order.paid,
  payment.failed, refund.processed, refund.failed and the secret from `RAZORPAY_WEBHOOK_SECRET` (test-mode
  webhook setup asks for OTP 754081). Not set up in this repo.

## Backlog
- Rate limiting on booking endpoints (create, token guessing, confirm).
- OTP (email/SMS) for "manage booking" by reference + email, instead of only the guest token.
- KMS / secret manager for `BOOKING_DATA_KEY` (+ rotation to `v2:` values).
- Real insurance partner behind `InsuranceProvider`.
- Admin exception queue for stuck CONFIRMING bookings + Duffel `order.created` / `order.creation_failed`
  webhook reconciliation; also for REFUND_FAILED payments and amount mismatches (today: ERROR logs).
- Expiry sweep job (expiry is lazy today).
- When markup/convenience fee > 0: GST on the service fee and invoice requirements — confirm rules with
  the client's CA before enabling.
- Webhook endpoint rate limiting / Razorpay IP allowlist at the edge.
- Separate worker process entry point (`dist/worker.js` with no HTTP) for production; today the same
  `main.js` with `WORKERS_ENABLED=true` (and `false` on API instances).
- Re-send of a lost confirmation email (an email enqueue that fails is only logged).
- Cancellation flow (Step 9): `CANCELLATION_FEE_MINOR` is configured but not used yet.

## Commands (run from repo root)
- `pnpm --filter @ota/api dev` · `test` · `test:e2e` · `build`
- `pnpm db:up` starts Postgres 16 + Redis 7 + Mailpit (Docker)