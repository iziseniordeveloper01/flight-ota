import type {
  Ancillaries,
  CallOptions,
  CreateOrderInput,
  FlightOffer,
  OrderLookup,
  OrderResult,
  PriceOptions,
  PricedOffer,
  SearchRequest,
  SeatMap,
  SupplierName,
} from './types.js';

/**
 * The single seam between our app and any flight supplier. Implementations must:
 * - return only normalized types (types.ts), with money as decimal strings;
 * - throw only SupplierError (errors.ts);
 * - honour CallOptions: abort the in-flight HTTP request on `signal` or after `timeoutMs`.
 *
 * Booking is a single instant order (pay + ticket in one call). Mapping for TBO:
 *   getAncillaries / getSeatMaps ↔ SSR · createOrder ↔ Book + Ticket (LCC: Ticket only)
 *   retrieveOrder ↔ GetBookingDetails
 * Adapters read whatever booking context they need from FlightOffer.supplierRef.
 */
export interface SupplierAdapter {
  readonly name: SupplierName;
  search(req: SearchRequest, opts?: CallOptions): Promise<FlightOffer[]>;
  /** Latest price for an offer returned by search(). */
  price(supplierOfferId: string, opts?: PriceOptions): Promise<PricedOffer>;
  /** Extra bags, whether seats can be chosen, and passenger data the supplier requires. */
  getAncillaries(supplierOfferId: string, opts?: CallOptions): Promise<Ancillaries>;
  /** One seat map per segment that supports seat selection (may be empty). */
  getSeatMaps(supplierOfferId: string, opts?: CallOptions): Promise<SeatMap[]>;
  /**
   * Books and pays in one step. Never retry on TIMEOUT: the order may exist — use retrieveOrder.
   * Total ≠ expectedTotal → SupplierError PRICE_CHANGED.
   */
  createOrder(input: CreateOrderInput, opts?: CallOptions): Promise<OrderResult>;
  /** The order createOrder() made for this lookup, or null if the supplier doesn't (yet) know it. */
  retrieveOrder(lookup: OrderLookup, opts?: CallOptions): Promise<OrderResult | null>;
}
