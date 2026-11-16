import type { FlightOffer } from './types.js';

/**
 * Stable identity of "the same fare on the same flights", independent of the search that produced
 * it: offer ids, passenger/segment refs, prices and expiry differ between two searches, this doesn't.
 * Used to find the customer's chosen fare again in a fresh search (re-shop at checkout).
 *
 * Built from every segment (marketing carrier + flight number + route + local departure + cabin),
 * the fare brand and the passenger type counts. Readable on purpose (it is not a secret and helps
 * debugging), e.g. "BA117:LHR-JFK@2026-12-01T10:00:00/economy|brand:Classic|pax:a1c0i0".
 */
export function offerFingerprint(offer: Pick<FlightOffer, 'slices' | 'fareBrand' | 'passengers'>): string {
  const segments = offer.slices
    .map((slice) =>
      slice.segments
        .map((s) => `${s.marketingCarrier.code}${s.flightNumber}:${s.origin}-${s.destination}@${s.departureAt}/${s.cabin}`)
        .join('+'),
    )
    .join('>');
  const count = (type: FlightOffer['passengers'][number]['type']) => offer.passengers.filter((p) => p.type === type).length;
  return `${segments}|brand:${offer.fareBrand ?? ''}|pax:a${count('adult')}c${count('child')}i${count('infant')}`;
}
