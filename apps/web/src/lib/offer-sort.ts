import { compareMoney, type PublicFlightOffer } from '@ota/contracts';

export const SORT_KEYS = ['recommended', 'cheapest', 'fastest'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** Total elapsed travel time over all slices (minutes). */
export function totalDuration(offer: PublicFlightOffer): number {
  return offer.slices.reduce((sum, s) => sum + s.durationMinutes, 0);
}

/**
 * Price order with decimal-string comparison (compareMoney, BigInt inside, no floats).
 * compareMoney throws on mixed currencies, so different currencies are grouped by code first.
 */
export function comparePrice(a: PublicFlightOffer, b: PublicFlightOffer): number {
  const ca = a.price.total.currency;
  const cb = b.price.total.currency;
  if (ca !== cb) return ca < cb ? -1 : 1;
  return compareMoney(a.price.total, b.price.total);
}

/** Returns a new array; Array.prototype.sort is stable, so ties keep supplier order. */
export function sortOffers(offers: PublicFlightOffer[], key: SortKey): PublicFlightOffer[] {
  if (key === 'recommended') return offers.slice();
  if (key === 'cheapest') return offers.slice().sort(comparePrice);
  return offers
    .slice()
    .sort((a, b) => totalDuration(a) - totalDuration(b) || comparePrice(a, b));
}

/** First offer each tab would show, for the lead price on the tab itself. */
export function leadOffers(
  offers: PublicFlightOffer[],
): Record<SortKey, PublicFlightOffer | undefined> {
  return {
    recommended: offers[0],
    cheapest: sortOffers(offers, 'cheapest')[0],
    fastest: sortOffers(offers, 'fastest')[0],
  };
}
