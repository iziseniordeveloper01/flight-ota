// Public HTTP contract shared by @ota/api and @ota/web: request schemas, public response types.
// Domain types come from @ota/suppliers (type-only) so there is one source of truth; the only
// runtime code taken from it is the pure money module (via its ./money subpath, never the adapters).
export * from './airports.js';
export * from './flights.js';
export type * from './errors.js';
export type {
  BaggageAllowance,
  CabinClass,
  Carrier,
  Money,
  PassengerPrice,
  PassengerType,
  Segment,
  Slice,
  SupplierName,
} from '@ota/suppliers';
export { compareMoney, currencyDigits, fromMinor, toMinor } from '@ota/suppliers/money';
