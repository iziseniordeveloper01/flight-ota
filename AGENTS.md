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
- `docker-compose.yml` — local Postgres 16 + Redis 7 + Mailpit (`pnpm db:up` / `pnpm db:down`; Mailpit UI
  http://127.0.0.1:8025, SMTP 127.0.0.1:1025 — every email the API sends locally lands there)

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
- `FlightOffer.passengers[].ref` / `Segment.ref` are opaque supplier ids, safe to return: bags, seats and
  orders refer to passengers and flights by them.
- Suppliers allow ONE order per search (Duffel offer request, TBO TraceId). Never book the cached offer that
  every viewer of a search shares: `POST /bookings` re-shops (fresh search, same `offerFingerprint()`).

## Bookings (guest checkout) — details in `apps/api/AGENTS.md`
- State machine: DRAFT → PENDING_PAYMENT → PAID → CONFIRMING → CONFIRMED (→ CANCELLED later); CONFIRMING →
  FAILED; DRAFT/PENDING_PAYMENT → EXPIRED; FAILED/EXPIRED → REFUND_PENDING → REFUNDED (money given back).
  Status changes ONLY via `BookingStore.transition()`.
- Passenger PII (DOB, passport number) is AES-256-GCM encrypted with `BOOKING_DATA_KEY`; document numbers
  never leave the API unmasked. Never log names, DOBs, documents, emails or phones.
- Guests manage a booking with the `X-Booking-Token` returned once at creation (only its sha256 is stored).
- `POST /bookings/:id/confirm-demo` works only with `PAYMENT_PROVIDER=demo` (404 otherwise and in production).

## Money the customer pays (pricing, FX, payments) — details in `apps/api/AGENTS.md`
- Customers pay in `CHARGE_CURRENCY` (INR). Every price that leaves the API has the supplier's own `price`
  AND a `displayPrice` in INR (offers, bags, seats; bookings: `displayPrice` breakdown). The web shows ONLY
  `displayPrice`. Conversion: rate (Frankfurter) × (1 + `FX_BUFFER_PERCENT`), rounded UP to the whole
  rupee per line; INR passes through exactly; markup on the fare from config. The total = sum of the lines.
- Payments: Razorpay (`PAYMENT_PROVIDER=razorpay`, test keys `rzp_test_…`). The amount is ALWAYS computed by
  the server from the booking. Money arriving is handled by one idempotent `markPaid()` (verify, webhook,
  reconciliation). Background work runs in BullMQ queues (same Redis). Emails via SMTP (Mailpit locally).
- Never put PII in job payloads, provider notes, webhook rows or logs (ids, amounts, statuses only).
- The server decides whether a passport is required: `GET …/ancillaries` returns
  `identityDocumentRequired` resolved to true/false; the booking view carries `airports` + `trip.international`.
- Web: the browser never sees the guest token — Next route handlers (`/api/bookings/*`) keep it in an
  httpOnly cookie and add it server-side (see `apps/web/AGENTS.md`).

## Contracts
- Request schemas and public types live in `@ota/contracts`; api and web both import from there. Never
  re-declare a request schema or response shape in an app.
- `@ota/contracts` depends only on `zod` and `@ota/suppliers` (domain types type-only, plus the pure
  `@ota/suppliers/money` subpath). Never `@ota/db`, a supplier SDK, or the adapters.
- Changing a schema changes both the API validation and the web form: run both apps' tests.

## Rules
- Secrets only in the root `.env` (git-ignored); document every variable in `.env.example`. Never print or commit `.env` values.
- From the root: `pnpm build` · `pnpm typecheck` · `pnpm test` · `pnpm dev` (api :4000 + web :3000).
