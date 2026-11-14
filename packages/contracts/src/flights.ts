import type { CabinClass, FlightOffer, PricedOffer, SupplierName } from '@ota/suppliers';
import { z } from 'zod';

export const MAX_DAYS_AHEAD = 361; // airlines publish schedules ~11–12 months out
export const MAX_SEATED_PASSENGERS = 9;
// `satisfies` ties this runtime list to the domain union, so the two cannot drift apart.
export const CABIN_CLASSES = [
  'economy',
  'premium_economy',
  'business',
  'first',
] as const satisfies readonly CabinClass[];

const iata = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter IATA code');

// z.iso.date() checks the YYYY-MM-DD shape AND that the day exists (rejects 2026-02-30).
const isoDate = z.iso.date('Must be a date in YYYY-MM-DD format');

function utcDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * First and last bookable departure dates (YYYY-MM-DD). The schema below and the web calendar
 * both use this, so the UI never offers a date the API would reject.
 * Timezone caveat: "today" is the UTC date. Just after midnight in e.g. India (UTC+5:30) the
 * local date is already tomorrow, so a same-day search can briefly be accepted/rejected a few
 * hours early or late. Fine for now; the precise rule is "today at the origin airport".
 */
export function searchDateBounds(): { first: string; last: string } {
  return { first: utcDate(), last: utcDate(MAX_DAYS_AHEAD) };
}

export const searchFlightsSchema = z
  .object({
    origin: iata,
    destination: iata,
    departureDate: isoDate,
    returnDate: isoDate.optional(),
    adults: z.number().int().min(1).max(9).default(1),
    children: z.number().int().min(0).max(8).default(0),
    infants: z.number().int().min(0).max(9).default(0),
    cabin: z.enum(CABIN_CLASSES).default('economy'),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 code')
      .optional(),
  })
  .superRefine((body, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (body.origin === body.destination) issue('destination', 'Must differ from origin');

    // YYYY-MM-DD strings compare correctly as plain strings.
    const { first, last } = searchDateBounds();
    if (body.departureDate < first) issue('departureDate', 'Must not be in the past');
    if (body.departureDate > last) {
      issue('departureDate', `Must be within ${MAX_DAYS_AHEAD} days`);
    }
    if (body.returnDate !== undefined) {
      if (body.returnDate < body.departureDate) {
        issue('returnDate', 'Must be on or after departureDate');
      }
      if (body.returnDate > last) issue('returnDate', `Must be within ${MAX_DAYS_AHEAD} days`);
    }

    // Lap infants travel on an adult's lap: at most one per adult.
    if (body.infants > body.adults) issue('infants', 'Cannot exceed the number of adults');
    if (body.adults + body.children > MAX_SEATED_PASSENGERS) {
      issue('children', `Adults + children cannot exceed ${MAX_SEATED_PASSENGERS}`);
    }
  });

/** Parsed body (defaults applied). */
export type SearchFlightsBody = z.output<typeof searchFlightsSchema>;
/** What a client may send (defaulted fields optional). */
export type SearchFlightsInput = z.input<typeof searchFlightsSchema>;

// Our public offer ids: `${supplier}:${supplierOfferId}`. 256: the stateless mock encodes the whole
// search in its id (base64url JSON, up to ~162 chars).
export const offerIdSchema = z
  .string()
  .regex(/^(mock|duffel|tbo):[A-Za-z0-9_-]{1,256}$/, 'Malformed offer id');

/** An offer as it leaves the API: server-only `supplierRef` removed. */
export type PublicOffer<T extends FlightOffer = FlightOffer> = Omit<T, 'supplierRef'>;
export type PublicFlightOffer = PublicOffer<FlightOffer>;
export type PublicPricedOffer = PublicOffer<PricedOffer>;

/** POST /v1/flights/search */
export interface SearchFlightsResponse {
  data: PublicFlightOffer[];
  meta: {
    supplier: SupplierName;
    cached: boolean;
    count: number;
    /** null when offers come back in more than one currency (then they stay in supplier order). */
    currency: string | null;
    /** Test inventory (mock / Duffel test mode): not bookable. */
    demo: boolean;
  };
}

/** GET /v1/flights/offers/:id */
export interface OfferResponse {
  data: PublicPricedOffer;
  meta: { supplier: SupplierName; demo: boolean };
}
