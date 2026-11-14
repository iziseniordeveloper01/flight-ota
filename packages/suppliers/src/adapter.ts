import type {
  CallOptions,
  FlightOffer,
  PriceOptions,
  PricedOffer,
  SearchRequest,
  SupplierName,
} from './types.js';

/**
 * The single seam between our app and any flight supplier. Implementations must:
 * - return only normalized types (types.ts), with money as decimal strings;
 * - throw only SupplierError (errors.ts);
 * - honour CallOptions: abort the in-flight HTTP request on `signal` or after `timeoutMs`.
 *
 * Step 6 will add booking: createOrder / issue / retrieve / cancelQuote / cancel.
 * Mapping: Duffel hold order (+ payment to issue) ↔ TBO Book (+ Ticket); for TBO LCC fares
 * Book and Ticket collapse into one Ticket call. Adapters read what they need from
 * FlightOffer.supplierRef.
 */
export interface SupplierAdapter {
  readonly name: SupplierName;
  search(req: SearchRequest, opts?: CallOptions): Promise<FlightOffer[]>;
  /** Latest price for an offer returned by search(). */
  price(supplierOfferId: string, opts?: PriceOptions): Promise<PricedOffer>;
}
