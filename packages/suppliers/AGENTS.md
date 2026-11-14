# @ota/suppliers — agent notes

Flight supplier adapters behind one interface. Pure library: no Nest, no env reads (config comes in
through constructors), ESM + NodeNext, Vitest.

## Layout
- `src/types.ts` normalized domain types · `src/adapter.ts` `SupplierAdapter` · `src/errors.ts` `SupplierError`
- `src/money.ts` BigInt decimal-string money helpers · `src/call.ts` `callSignal()` (timeout + caller abort)
- `src/mock/` deterministic offline supplier. Scenario routes: PVD→RAI no offers, STN→LHR TIMEOUT,
  LHR→STN price rises on `price()`
- `src/duffel/` Duffel via native `fetch` (REST, `Duffel-Version: v2`)

## Rules
- Nothing exported from `src/index.ts` may reference a supplier SDK type. Duffel types (`@duffel/api`,
  a devDependency, type-only) stay inside `src/duffel/*`.
- Every HTTP call passes `callSignal(opts)` as its `signal` so timeouts really cancel the request. Don't
  use an SDK whose client can't take an AbortSignal (the Duffel SDK can't — that's why we use fetch).
- Map every failure to `SupplierError` (TIMEOUT, OFFER_EXPIRED, OFFER_NOT_FOUND, INVALID_REQUEST,
  UNAVAILABLE, UPSTREAM_ERROR). Messages: supplier error code/title/request id only — never tokens,
  headers or passenger data.
- Money: never `Number()`/`parseFloat` an amount. Fill `price.perPassenger` only from real supplier data.
- Tests: no network. Duffel tests inject a fake `fetch`. Live test is opt-in: `DUFFEL_LIVE_TEST=1 pnpm --filter "@ota/suppliers" test`.
