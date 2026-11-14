import {
  CABIN_CLASSES,
  searchFlightsSchema,
  type CabinClass,
  type SearchFlightsBody,
} from '@ota/contracts';
import {
  createSerializer,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsNumberLiteral,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs';
import { EMPTY_FILTERS, STOP_BUCKETS, TIME_BUCKETS, type OfferFilters } from './offer-filters';
import { SORT_KEYS } from './offer-sort';

export const RESULTS_PATH = '/flights/search';

/** Search URL params: /flights/search?from=DEL&to=BOM&depart=2026-12-15&adults=1&... */
export const searchParsers = {
  from: parseAsString,
  to: parseAsString,
  depart: parseAsString,
  return: parseAsString,
  adults: parseAsInteger.withDefault(1),
  children: parseAsInteger.withDefault(0),
  infants: parseAsInteger.withDefault(0),
  cabin: parseAsStringLiteral(CABIN_CLASSES).withDefault('economy'),
};

/** Result-page state, also in the URL so filtered links are shareable. Prices in minor units. */
export const filterParsers = {
  sort: parseAsStringLiteral(SORT_KEYS).withDefault('recommended'),
  stops: parseAsArrayOf(parseAsNumberLiteral(STOP_BUCKETS)).withDefault([]),
  airlines: parseAsArrayOf(parseAsString).withDefault([]),
  dep: parseAsArrayOf(parseAsStringLiteral(TIME_BUCKETS)).withDefault([]),
  pmin: parseAsInteger,
  pmax: parseAsInteger,
  refundable: parseAsBoolean.withDefault(false),
};

export interface SearchState {
  from: string | null;
  to: string | null;
  depart: string | null;
  return: string | null;
  adults: number;
  children: number;
  infants: number;
  cabin: CabinClass;
}

// Explicit params (adults=1&children=0...) even at their defaults, as in the spec'd URL shape.
const serializeSearch = createSerializer(searchParsers, { clearOnDefault: false });

export function searchUrl(state: SearchState): string {
  return serializeSearch(RESULTS_PATH, state);
}

export type SearchField = 'from' | 'to' | 'depart' | 'return' | 'pax' | 'cabin';
export type SearchErrors = Partial<Record<SearchField, string>>;

const FIELD_BY_PATH: Record<string, SearchField> = {
  origin: 'from',
  destination: 'to',
  departureDate: 'depart',
  returnDate: 'return',
  adults: 'pax',
  children: 'pax',
  infants: 'pax',
  cabin: 'cabin',
};

/** Validate URL/widget state with the shared contract schema (the same one the API uses). */
export function validateSearch(
  state: SearchState,
): { ok: true; body: SearchFlightsBody } | { ok: false; errors: SearchErrors } {
  const result = searchFlightsSchema.safeParse({
    origin: state.from ?? '',
    destination: state.to ?? '',
    departureDate: state.depart ?? '',
    returnDate: state.return ?? undefined,
    adults: state.adults,
    children: state.children,
    infants: state.infants,
    cabin: state.cabin,
  });
  if (result.success) return { ok: true, body: result.data };
  const errors: SearchErrors = {};
  for (const issue of result.error.issues) {
    const field = FIELD_BY_PATH[String(issue.path[0])];
    // Keep the first message per field.
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}

export function filtersFromParams(p: {
  stops: readonly (0 | 1 | 2)[];
  airlines: readonly string[];
  dep: readonly OfferFilters['times'][number][];
  pmin: number | null;
  pmax: number | null;
  refundable: boolean;
}): OfferFilters {
  return {
    stops: [...p.stops],
    airlines: [...p.airlines],
    times: [...p.dep],
    priceMin: p.pmin === null ? null : BigInt(p.pmin),
    priceMax: p.pmax === null ? null : BigInt(p.pmax),
    refundableOnly: p.refundable,
  };
}

export function filtersToParams(f: OfferFilters) {
  return {
    stops: f.stops,
    airlines: f.airlines,
    dep: f.times,
    // Minor units of real fares are far below 2^53, so Number() is exact here.
    pmin: f.priceMin === null ? null : Number(f.priceMin),
    pmax: f.priceMax === null ? null : Number(f.priceMax),
    refundable: f.refundableOnly,
  };
}

export const RESET_FILTER_PARAMS = filtersToParams(EMPTY_FILTERS);
