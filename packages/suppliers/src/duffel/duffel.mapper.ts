import { normalizeLocal } from '../local-time.js';
import { SEARCH_CHILD_AGE, SEARCH_INFANT_AGE } from '../passengers.js';
import type {
  BaggageAllowance,
  CabinClass,
  Carrier,
  FlightOffer,
  Money,
  PassengerType,
  SearchRequest,
  Segment,
  Slice,
} from '../types.js';
import type {
  CreateOfferRequest,
  CreateOfferRequestPassenger,
  FlightsCondition,
  Offer,
  OfferPassenger,
  OfferSlice,
  OfferSliceSegment,
} from './duffel.types.js';
import { isoDurationToMinutes } from './iso-duration.js';

/**
 * Our SearchRequest → Duffel offer request body. Duffel has no currency parameter, so it is ignored.
 * Duffel only accepts `type: 'adult'`; everyone under 18 must be sent with an `age`.
 */
export function toOfferRequest(req: SearchRequest): CreateOfferRequest {
  const slice = (origin: string, destination: string, date: string) => ({
    origin,
    destination,
    departure_date: date,
    departure_time: null,
    arrival_time: null,
  });
  const passengers: CreateOfferRequestPassenger[] = [
    ...Array.from({ length: req.adults }, () => ({ type: 'adult' as const })),
    ...Array.from({ length: req.children }, () => ({ age: SEARCH_CHILD_AGE })),
    ...Array.from({ length: req.infants }, () => ({ age: SEARCH_INFANT_AGE })),
  ];
  return {
    slices: [
      slice(req.origin, req.destination, req.departureDate),
      ...(req.returnDate ? [slice(req.destination, req.origin, req.returnDate)] : []),
    ],
    passengers,
    cabin_class: req.cabin,
  };
}

// Offers embedded in an offer request omit available_services; we never read that field.
export type DuffelOffer = Omit<Offer, 'available_services'>;

export function toFlightOffer(offer: DuffelOffer, fallbackCabin: CabinClass): FlightOffer {
  return {
    id: `duffel:${offer.id}`,
    supplier: 'duffel',
    supplierOfferId: offer.id,
    expiresAt: offer.expires_at,
    price: {
      total: money(offer.total_amount, offer.total_currency),
      base: money(offer.base_amount, offer.base_currency),
      // tax_amount is null for some airlines — leave undefined rather than inventing "0.00".
      taxes:
        offer.tax_amount != null && offer.tax_currency != null
          ? money(offer.tax_amount, offer.tax_currency)
          : undefined,
      // Duffel offers carry no per-passenger amounts, so perPassenger stays undefined (never estimated).
    },
    owner: carrier(offer.owner),
    slices: offer.slices.map((s) => toSlice(s, fallbackCabin)),
    passengers: offer.passengers.map((p) => ({ ref: p.id, type: passengerType(p) })),
    baggage: baggage(offer),
    fareBrand: offer.slices[0]?.fare_brand_name ?? undefined,
    refundable: allowed(offer.conditions?.refund_before_departure),
    changeable: allowed(offer.conditions?.change_before_departure),
    requiresInstantPayment: offer.payment_requirements.requires_instant_payment,
    // Everything Step 6 needs to create a Duffel order without searching again.
    supplierRef: {
      offerId: offer.id,
      passengers: offer.passengers.map((p) => ({ id: p.id, type: p.type, age: p.age })),
    },
  };
}

function toSlice(slice: OfferSlice, fallbackCabin: CabinClass): Slice {
  const segments = slice.segments.map((s) => toSegment(s, fallbackCabin));
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    origin: slice.origin.iata_code ?? first.origin,
    destination: slice.destination.iata_code ?? last.destination,
    departureAt: first.departureAt,
    arrivalAt: last.arrivalAt,
    // Duffel normally sends the slice duration. If it doesn't, the sum of flight times is the best
    // we can do: layovers can't be derived from local times without each airport's offset.
    durationMinutes: slice.duration
      ? isoDurationToMinutes(slice.duration)
      : segments.reduce((sum, s) => sum + s.durationMinutes, 0),
    stops: segments.length - 1,
    segments,
  };
}

function toSegment(segment: OfferSliceSegment, fallbackCabin: CabinClass): Segment {
  return {
    ref: segment.id,
    marketingCarrier: carrier(segment.marketing_carrier),
    operatingCarrier: carrier(segment.operating_carrier),
    flightNumber: segment.marketing_carrier_flight_number,
    origin: segment.origin.iata_code ?? '',
    destination: segment.destination.iata_code ?? '',
    departureTerminal: segment.origin_terminal ?? undefined,
    arrivalTerminal: segment.destination_terminal ?? undefined,
    // Duffel already sends airport-local times without offset; normalize to exactly 19 chars.
    departureAt: normalizeLocal(segment.departing_at),
    arrivalAt: normalizeLocal(segment.arriving_at),
    // Duration can be null in rare airline responses; 0 signals "unknown" rather than guessing.
    durationMinutes: segment.duration ? isoDurationToMinutes(segment.duration) : 0,
    // Typed non-null by the SDK, but Duffel documents aircraft as optional.
    aircraft: segment.aircraft?.name ?? undefined,
    cabin: segment.passengers[0]?.cabin_class ?? fallbackCabin,
  };
}

// We search under-18s by age, so Duffel echoes `age` (on the final slice's departure date — the
// same day our age rules use); `type` is only reliable for passengers sent as type 'adult'.
function passengerType(p: Pick<OfferPassenger, 'type' | 'age'>): PassengerType {
  if (p.age != null) return p.age < 2 ? 'infant' : p.age < 12 ? 'child' : 'adult';
  if (p.type === 'infant_without_seat') return 'infant';
  return p.type === 'child' ? 'child' : 'adult';
}

function carrier(airline:{ iata_code: string | null; name: string; logo_symbol_url: string | null }): Carrier {
  // The symbol (square mark) suits small inline sizes better than logo_lockup_url (mark + wordmark).
  return { code: airline.iata_code ?? '', name: airline.name, logoUrl: airline.logo_symbol_url ?? undefined };
}

function money(amount: string, currency: string): Money {
  return { amount, currency };
}

function allowed(condition: FlightsCondition | null | undefined): boolean | null {
  return condition ? condition.allowed : null;
}

// Allowance of the first passenger on the first segment (Duffel reports it per segment/passenger).
function baggage(offer: DuffelOffer): BaggageAllowance | undefined {
  const pax = offer.slices[0]?.segments[0]?.passengers[0];
  if (!pax) return undefined;
  const count = (type: 'checked' | 'carry_on') =>
    pax.baggages.filter((b) => b.type === type).reduce((sum, b) => sum + b.quantity, 0);
  // Duffel gives piece counts only; weight is not part of the allowance.
  return { checkedPieces: count('checked'), cabinPieces: count('carry_on') };
}
