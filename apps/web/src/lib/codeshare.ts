import type { Carrier, PublicFlightOffer, Segment } from '@ota/contracts';

// Duffel can send an airline without an IATA code (code ""); fall back to the name then.
function sameCarrier(a: Carrier, b: Carrier): boolean {
  return a.code && b.code ? a.code === b.code : a.name === b.name;
}

/** Codeshare: the segment is flown by a different airline than the one marketing it. */
export function isOperatedByOther(segment: Segment): boolean {
  return !sameCarrier(segment.operatingCarrier, segment.marketingCarrier);
}

/** Unique names (in journey order) of airlines other than the offer's owner that fly any segment. */
export function otherOperators(offer: Pick<PublicFlightOffer, 'owner' | 'slices'>): string[] {
  const names = new Set<string>();
  for (const slice of offer.slices) {
    for (const segment of slice.segments) {
      if (!sameCarrier(segment.operatingCarrier, offer.owner)) names.add(segment.operatingCarrier.name);
    }
  }
  return [...names];
}
