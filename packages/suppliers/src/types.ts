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
  /** Supplier's segment id within this offer (Duffel "seg_…"); links bags/seats to a flight. Opaque. */
  ref: string;
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
  /**
   * The passenger slots this offer was priced for, in search order (adults, children, infants).
   * `ref` is the supplier's opaque passenger id; bags, seats and orders refer to passengers by it.
   */
  passengers: OfferPassenger[];
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

export interface OfferPassenger {
  ref: string;
  type: PassengerType;
}

// ---------------------------------------------------------------------------------------------
// Booking: ancillaries, seat maps, orders. Same rule as above — normalized, never supplier-shaped.

/** An extra bag that can be added to an order. Price is per unit; one unit covers all `segmentRefs`. */
export interface BagOption {
  serviceId: string;
  passengerRef: string;
  segmentRefs: string[];
  /** Per unit, e.g. "23kg checked bag". */
  label: string;
  weightKg?: number;
  maxQuantity: number;
  price: Money;
}

export interface PassengerRequirements {
  /** true/false when the supplier says; null when it doesn't (the caller decides, e.g. international trips). */
  identityDocumentRequired: boolean | null;
  /** Longest given/family name the supplier accepts; null = no supplier-specific limit. */
  maxNameLength: number | null;
}

export interface Ancillaries {
  bags: BagOption[];
  seatsAvailable: boolean;
  passengerRequirements: PassengerRequirements;
}

/** Seats are priced per passenger (a child seat may cost less), so each passenger has its own service. */
export interface SeatService {
  passengerRef: string;
  serviceId: string;
  price: Money;
}

export type SeatMapElement =
  | {
      type: 'seat';
      /** Row number + column letter, e.g. "14C". */
      designator: string;
      /** false when no passenger can book it (services is empty). */
      available: boolean;
      /** Airline's description, e.g. "Extra legroom". */
      name?: string;
      /** Airline terms shown to the customer (e.g. exit-row restrictions). */
      disclosures?: string[];
      services: SeatService[];
    }
  | { type: 'gap' }
  | { type: 'exit' }
  | { type: 'facility'; kind: 'lavatory' | 'galley' | 'closet' | 'stairs' | 'bassinet' };

export interface SeatMapRow {
  /** null for rows without seats (exit markers, galleys). */
  number: number | null;
  /** Sections are split by aisles. */
  sections: Array<{ elements: SeatMapElement[] }>;
}

export interface SeatMap {
  segmentRef: string;
  /** Ordered by deck (0 = main), then front to back. */
  cabins: Array<{ deck: number; rows: SeatMapRow[] }>;
}

export interface OrderPassenger {
  /** OfferPassenger.ref of the slot this person fills. */
  ref: string;
  type: PassengerType;
  title: 'mr' | 'mrs' | 'ms' | 'miss';
  gender: 'm' | 'f';
  givenName: string;
  /** null for mononyms; each adapter applies its supplier's convention. */
  familyName: string | null;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  /** ISO 3166-1 alpha-2 */
  nationality: string;
  document?: { type: 'passport'; number: string; issuingCountry: string; expiryDate: string };
  /** Infants only: ref of the adult whose lap they travel on. */
  associatedAdultRef?: string;
}

export interface CreateOrderInput {
  supplierOfferId: string;
  supplierRef: Record<string, unknown>;
  passengers: OrderPassenger[];
  contact: { email: string; phone: string };
  services: Array<{ serviceId: string; quantity: number }>;
  /** Fare + services the customer agreed to. A different supplier total → SupplierError PRICE_CHANGED. */
  expectedTotal: Money;
  /** Unique per booking; stored with the supplier order so a lost response can be found again. */
  idempotencyKey: string;
}

export interface OrderResult {
  supplierOrderId: string;
  /** Airline booking reference; null while the supplier is still confirming. */
  pnr: string | null;
  status: 'confirmed' | 'pending';
  total: Money;
}

/**
 * Finds an order created by createOrder(). After a timeout we have no supplierOrderId, so adapters
 * search by what they stored at creation (idempotencyKey) plus the lead passenger's name.
 */
export interface OrderLookup {
  supplierOrderId?: string;
  idempotencyKey: string;
  leadPassenger: { givenName: string; familyName: string | null };
  expectedTotal: Money;
}

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
