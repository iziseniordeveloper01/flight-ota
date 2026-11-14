// Normalized flight domain types. Every supplier adapter maps INTO these; API and booking code
// only ever see these, never a supplier's own shapes.

export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';
export type SupplierName = 'mock' | 'duffel' | 'tbo';
export type PassengerType = 'adult' | 'child' | 'infant';

export interface SearchRequest {
  /** IATA airport/city code, uppercase. */
  origin: string;
  destination: string;
  /** YYYY-MM-DD, local date at the origin. */
  departureDate: string;
  /** YYYY-MM-DD. Present → round trip (2 slices). */
  returnDate?: string;
  adults: number;
  children: number;
  infants: number;
  cabin: CabinClass;
  /** Preferred ISO 4217 currency. A hint only: some suppliers (Duffel) always price in their own currency. */
  currency?: string;
}

/**
 * Money is NEVER a float. `amount` is a decimal string ("123.45") in `currency` (ISO 4217).
 * Use the helpers in money.ts to compare or do arithmetic.
 */
export interface Money {
  amount: string;
  currency: string;
}

export interface Carrier {
  /** IATA airline code, e.g. "BA". */
  code: string;
  name: string;
  /** Square airline logo (absolute https URL) when the supplier provides one. */
  logoUrl?: string;
}

/**
 * Date-times on segments and slices are AIRPORT-LOCAL wall-clock times in the form
 * "YYYY-MM-DDTHH:mm:ss" with NO offset — exactly what airlines publish and what a traveller sees
 * on the ticket. Departure is local to the origin airport, arrival local to the destination.
 * Never compare them across airports or parse them as UTC; use `durationMinutes` for elapsed time.
 */
export interface Segment {
  marketingCarrier: Carrier;
  operatingCarrier: Carrier;
  /** Marketing carrier's flight number without the airline code, e.g. "117". */
  flightNumber: string;
  origin: string;
  destination: string;
  departureTerminal?: string;
  arrivalTerminal?: string;
  /** Airport-local, no offset (see above). */
  departureAt: string;
  /** Airport-local, no offset (see above). */
  arrivalAt: string;
  durationMinutes: number;
  aircraft?: string;
  cabin: CabinClass;
}

/** One directional leg of the journey (outbound or return), made of 1+ segments. */
export interface Slice {
  origin: string;
  destination: string;
  /** Airport-local, no offset. */
  departureAt: string;
  /** Airport-local, no offset. */
  arrivalAt: string;
  /** Total elapsed time including connections. */
  durationMinutes: number;
  stops: number;
  segments: Segment[];
}

export interface BaggageAllowance {
  checkedPieces?: number;
  checkedWeightKg?: number;
  cabinPieces?: number;
}

export interface PassengerPrice {
  type: PassengerType;
  count: number;
  /** Total for all `count` passengers of this type. */
  total: Money;
}

export interface FlightOffer {
  /** OUR id: `${supplier}:${supplierOfferId}`. */
  id: string;
  supplier: SupplierName;
  supplierOfferId: string;
  /** ISO 8601 instant WITH offset (or Z); after this the supplier will not honour the offer. */
  expiresAt: string;
  price: {
    total: Money;
    base?: Money;
    taxes?: Money;
    /** Only when the supplier really provides a breakdown — never estimated. */
    perPassenger?: PassengerPrice[];
  };
  /** Validating / selling carrier. */
  owner: Carrier;
  slices: Slice[];
  baggage?: BaggageAllowance;
  fareBrand?: string;
  /** null = the supplier gave no information. */
  refundable: boolean | null;
  changeable: boolean | null;
  requiresInstantPayment: boolean;
  /**
   * Opaque supplier context needed later to book this offer (Duffel: offer + passenger ids;
   * TBO: TraceId, ResultIndex, IsLCC). Server-side only — the API must strip it before responding.
   */
  supplierRef: Record<string, unknown>;
}

export type PricedOffer = FlightOffer & {
  priceChanged: boolean;
  /** The total the caller saw before re-pricing, set when the price changed. */
  previousTotal?: Money;
};

export interface CallOptions {
  /** Caller-side cancellation (e.g. the HTTP client went away). */
  signal?: AbortSignal;
  /** Hard deadline for the whole supplier call; the in-flight HTTP request is aborted when it passes. */
  timeoutMs?: number;
}

export interface PriceOptions extends CallOptions {
  /** The total the customer saw at search time; used to compute `priceChanged`. */
  previousTotal?: Money;
}
