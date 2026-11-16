import { compareMoney, type Money, type PublicFlightOffer } from '@ota/contracts';
import { localHour } from './local-time';
import { moneyToMinor } from './money-format';

// Client-side filters over the loaded offers. Round-trip rules:
// - stops: the MOST stops on any slice ("Direct" = every slice is direct)
// - departure time: the OUTBOUND slice's departure, airport-local hour

export const STOP_BUCKETS = [0, 1, 2] as const; // 2 means "2 or more"
export type StopBucket = (typeof STOP_BUCKETS)[number];

export const TIME_BUCKETS = ['night', 'morning', 'afternoon', 'evening'] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];

export interface OfferFilters {
  stops: StopBucket[];
  airlines: string[];
  times: TimeBucket[];
  /** Inclusive bounds in minor units of the (single) result currency; null = unbounded. */
  priceMin: bigint | null;
  priceMax: bigint | null;
  refundableOnly: boolean;
}

export const EMPTY_FILTERS: OfferFilters = {
  stops: [],
  airlines: [],
  times: [],
  priceMin: null,
  priceMax: null,
  refundableOnly: false,
};

export function stopBucket(offer: PublicFlightOffer): StopBucket {
  const most = Math.max(...offer.slices.map((s) => s.stops));
  return most >= 2 ? 2 : (most as StopBucket);
}

/** 00–06 night, 06–12 morning, 12–18 afternoon, 18–24 evening. */
export function timeBucket(localDateTime: string): TimeBucket {
  const h = localHour(localDateTime);
  return h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

export function outboundTimeBucket(offer: PublicFlightOffer): TimeBucket {
  return timeBucket(offer.slices[0].departureAt);
}

/** Number of active filter groups, for the "Filters (n)" button. */
export function activeFilterCount(f: OfferFilters): number {
  return (
    (f.stops.length ? 1 : 0) +
    (f.airlines.length ? 1 : 0) +
    (f.times.length ? 1 : 0) +
    (f.priceMin !== null || f.priceMax !== null ? 1 : 0) +
    (f.refundableOnly ? 1 : 0)
  );
}

/** Single display currency of the result set (always the charge currency, INR); null only when empty. */
export function singleCurrency(offers: PublicFlightOffer[]): string | null {
  const set = new Set(offers.map((o) => o.displayPrice.total.currency));
  return set.size === 1 ? [...set][0] : null;
}

export function applyFilters(offers: PublicFlightOffer[], f: OfferFilters): PublicFlightOffer[] {
  const priceActive = (f.priceMin !== null || f.priceMax !== null) && singleCurrency(offers) !== null;
  return offers.filter((o) => {
    if (f.stops.length && !f.stops.includes(stopBucket(o))) return false;
    if (f.airlines.length && !f.airlines.includes(o.owner.code)) return false;
    if (f.times.length && !f.times.includes(outboundTimeBucket(o))) return false;
    // Unknown (null) refundability is excluded: we only promise what the airline confirmed.
    if (f.refundableOnly && o.refundable !== true) return false;
    if (priceActive) {
      const minor = moneyToMinor(o.displayPrice.total);
      if (f.priceMin !== null && minor < f.priceMin) return false;
      if (f.priceMax !== null && minor > f.priceMax) return false;
    }
    return true;
  });
}

export interface FilterFacets {
  stops: Record<StopBucket, number>;
  airlines: { code: string; name: string; logoUrl?: string; count: number; minPrice: Money | null }[];
  times: Record<TimeBucket, number>;
  /** null when there are no offers or currencies are mixed. */
  price: { min: bigint; max: bigint; currency: string } | null;
}

/** Counts/min prices over ALL loaded offers (not the filtered subset), so options stay stable. */
export function filterFacets(offers: PublicFlightOffer[]): FilterFacets {
  const stops: Record<StopBucket, number> = { 0: 0, 1: 0, 2: 0 };
  const times: Record<TimeBucket, number> = { night: 0, morning: 0, afternoon: 0, evening: 0 };
  const airlines = new Map<string, FilterFacets['airlines'][number]>();
  const currency = singleCurrency(offers);
  let min: bigint | null = null;
  let max: bigint | null = null;

  for (const o of offers) {
    stops[stopBucket(o)] += 1;
    times[outboundTimeBucket(o)] += 1;

    const a = airlines.get(o.owner.code) ?? {
      code: o.owner.code,
      name: o.owner.name,
      logoUrl: o.owner.logoUrl,
      count: 0,
      minPrice: null,
    };
    a.count += 1;
    if (currency && (a.minPrice === null || compareMoney(o.displayPrice.total, a.minPrice) < 0)) {
      a.minPrice = o.displayPrice.total;
    }
    airlines.set(o.owner.code, a);

    if (currency) {
      const minor = moneyToMinor(o.displayPrice.total);
      if (min === null || minor < min) min = minor;
      if (max === null || minor > max) max = minor;
    }
  }

  return {
    stops,
    times,
    airlines: [...airlines.values()].sort((x, y) => x.name.localeCompare(y.name)),
    price: currency && min !== null && max !== null ? { min, max, currency } : null,
  };
}
