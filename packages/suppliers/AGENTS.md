# @ota/suppliers — agent notes

Flight supplier adapters behind one interface. Pure library: no Nest, no env reads (config comes in
through constructors), ESM + NodeNext, Vitest.

## Layout
- `src/types.ts` normalized domain types · `src/adapter.ts` `SupplierAdapter` · `src/errors.ts` `SupplierError`
- `src/money.ts` BigInt decimal-string money helpers · `src/call.ts` `callSignal()` (timeout + caller abort)
- `src/mock/` deterministic, stateless offline supplier: `supplierOfferId` is base64url JSON of the
  search request + offer index, and `price()` regenerates the offer from it (survives restarts; past
  departure date → OFFER_EXPIRED). Bags/seats/orders are regenerated from the offer id too (service ids
  are deterministic strings; `mko_…` order ids encode the result). Scenarios:
  - routes: PVD→RAI no offers, STN→LHR TIMEOUT, LHR→STN price rises on `price()`,
    LGW→LHR "late booking": within 14 days of departure (by the injected `now`) the fare is +10% and the
    23kg bag sells out (used by the checkout re-price e2e tests)
  - passenger family name: `FAIL` → UPSTREAM_ERROR, `PRICECHANGE` → PRICE_CHANGED (+12%),
    `TIMEOUT` (lead passenger) → TIMEOUT but the order exists: `retrieveOrder(lookup)` finds it
- `src/duffel/` Duffel via native `fetch` (REST, `Duffel-Version: v2`); `duffel.booking-mapper.ts` maps
  ancillaries, seat maps and orders

## Booking methods (TBO mapping in `adapter.ts`)
- `getAncillaries` (bags + seatsAvailable + passengerRequirements), `getSeatMaps` (per segment, seats priced
  per passenger), `createOrder` (instant: book + pay; Duffel test mode pays with `balance`),
  `retrieveOrder(lookup)` (by supplierOrderId, or — after a lost response — by idempotencyKey + lead name).
- Duffel has NO Idempotency-Key: never retry `createOrder`. Our booking id goes into `order.metadata.ota_booking_id`.
  Order creation needs `timeoutMs` ≥ 130 000 (Duffel guidance).
- Total ≠ `expectedTotal` → `PRICE_CHANGED` (with `newTotal` when known). Duffel `order_creation_already_attempted`
  → OFFER_EXPIRED.
- Supplier naming conventions (e.g. mononym = given name repeated as family name for Duffel) live in the
  adapter, never in the API.

## Rules
- Nothing exported from `src/index.ts` may reference a supplier SDK type. Duffel types (`@duffel/api`,
  a devDependency, type-only) stay inside `src/duffel/*`.
- Every HTTP call passes `callSignal(opts)` as its `signal` so timeouts really cancel the request. Don't
  use an SDK whose client can't take an AbortSignal (the Duffel SDK can't — that's why we use fetch).
- Map every failure to `SupplierError` (TIMEOUT, OFFER_EXPIRED, OFFER_NOT_FOUND, INVALID_REQUEST,
  UNAVAILABLE, UPSTREAM_ERROR, PRICE_CHANGED). Messages: supplier error code/title/request id only — never tokens,
  headers or passenger data.
- Money: never `Number()`/`parseFloat` an amount. Fill `price.perPassenger` only from real supplier data.
- Tests: no network. Duffel tests inject a fake `fetch`. Live test is opt-in: `DUFFEL_LIVE_TEST=1 pnpm --filter "@ota/suppliers" test`.
