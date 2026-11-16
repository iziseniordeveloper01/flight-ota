import type { BookingStatus, OfferPassenger, PublicFlightOffer } from '@ota/contracts';
import { messages } from './messages';
import { searchUrl } from './search-params';

export const bookingPath = (id: string) => `/booking/${id}`;
export const reviewPath = (id: string) => `/booking/${id}/review`;
export const completePath = (id: string) => `/booking/${id}/complete`;
export const tripSummaryPath = (offerId: string) => `/flights/confirm?${new URLSearchParams({ offer: offerId })}`;

/**
 * Which page shows a booking in this status. Step 1 also shows EXPIRED (blocking dialog); the review
 * page also shows CONFIRMING (polling) and FAILED (failure message).
 */
export function stepPathFor(id: string, status: BookingStatus): string {
  switch (status) {
    case 'DRAFT':
    case 'EXPIRED':
      return bookingPath(id);
    case 'PENDING_PAYMENT':
    case 'CONFIRMING':
    case 'FAILED':
      return reviewPath(id);
    case 'CONFIRMED':
    case 'CANCELLED':
      return completePath(id);
  }
}

/** Results page for the same trip (route, dates, passengers, cabin): "Search again" / "Back to results". */
export function searchUrlForOffer(offer: Pick<PublicFlightOffer, 'slices' | 'passengers'>): string {
  const [outbound, inbound] = offer.slices;
  const count = (type: OfferPassenger['type']) => offer.passengers.filter((p) => p.type === type).length;
  return searchUrl({
    from: outbound.origin,
    to: outbound.destination,
    depart: outbound.departureAt.slice(0, 10),
    return: inbound ? inbound.departureAt.slice(0, 10) : null,
    adults: Math.max(1, count('adult')),
    children: count('child'),
    infants: count('infant'),
    cabin: outbound.segments[0]?.cabin ?? 'economy',
  });
}

/** "Adult 1", "Adult 2", "Child 1", "Infant 1" by passenger ref, numbered per type in offer order. */
export function passengerLabels(passengers: OfferPassenger[]): Map<string, string> {
  const seen = { adult: 0, child: 0, infant: 0 };
  return new Map(passengers.map((p) => [p.ref, messages.booking.passengerLabel(p.type, ++seen[p.type])]));
}
