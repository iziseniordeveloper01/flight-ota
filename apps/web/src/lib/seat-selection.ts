import {
  currencyDigits,
  toMinor,
  type Money,
  type OfferPassenger,
  type PublicBookingAncillary,
  type SeatMapElement,
  type SeatMapRow,
  type SeatService,
} from '@ota/contracts';
import { messages } from './messages';

export type SeatElement = Extract<SeatMapElement, { type: 'seat' }>;

export interface SelectedSeat {
  serviceId: string;
  /** "Seat 14C" */
  label: string;
  price: Money;
}

/** segmentRef → passengerRef → seat. At most one seat per passenger per flight by construction. */
export type SeatSelection = Record<string, Record<string, SelectedSeat>>;

export type SeatStatus = 'free' | 'paid' | 'unavailable' | 'selected' | 'taken';

export const isFree = (m: Money) => toMinor(m.amount, currencyDigits(m.currency)) === 0n;

/** Infants sit on a lap: they never choose seats. */
export function seatChoosers(passengers: OfferPassenger[]): OfferPassenger[] {
  return passengers.filter((p) => p.type !== 'infant');
}

/**
 * How a seat looks for the passenger who is choosing. Seats are priced per passenger, so "free",
 * "paid" and "unavailable" depend on who is active; "taken" = held by another passenger in this booking.
 */
export function seatStatus(
  seat: SeatElement,
  segmentRef: string,
  passengerRef: string,
  selection: SeatSelection,
): { status: SeatStatus; service?: SeatService } {
  const ids = new Set(seat.services.map((s) => s.serviceId));
  const onFlight = selection[segmentRef] ?? {};
  const service = seat.available ? seat.services.find((s) => s.passengerRef === passengerRef) : undefined;
  const mine = onFlight[passengerRef];
  if (mine && ids.has(mine.serviceId)) return { status: 'selected', service };
  if (Object.entries(onFlight).some(([ref, s]) => ref !== passengerRef && ids.has(s.serviceId))) return { status: 'taken' };
  if (!service) return { status: 'unavailable' };
  return { status: isFree(service.price) ? 'free' : 'paid', service };
}

/** Tap on a seat: select it (replacing the passenger's previous seat on this flight) or deselect it. */
export function toggleSeat(
  selection: SeatSelection,
  segmentRef: string,
  passenger: OfferPassenger,
  seat: SeatElement,
): SeatSelection {
  if (passenger.type === 'infant') return selection;
  const { status, service } = seatStatus(seat, segmentRef, passenger.ref, selection);
  const onFlight = { ...selection[segmentRef] };
  if (status === 'selected') delete onFlight[passenger.ref];
  else if ((status === 'free' || status === 'paid') && service) {
    onFlight[passenger.ref] = { serviceId: service.serviceId, label: messages.booking.seatLabel(seat.designator), price: service.price };
  } else return selection;
  return { ...selection, [segmentRef]: onFlight };
}

export function clearSeat(selection: SeatSelection, segmentRef: string, passengerRef: string): SeatSelection {
  const onFlight = { ...selection[segmentRef] };
  delete onFlight[passengerRef];
  return { ...selection, [segmentRef]: onFlight };
}

/** Drop seats whose service ids the API reported as no longer available. */
export function withoutServices(selection: SeatSelection, serviceIds: string[]): SeatSelection {
  const gone = new Set(serviceIds);
  return Object.fromEntries(
    Object.entries(selection).map(([seg, byPax]) => [seg, Object.fromEntries(Object.entries(byPax).filter(([, s]) => !gone.has(s.serviceId)))]),
  );
}

export const selectedSeats = (selection: SeatSelection): SelectedSeat[] => Object.values(selection).flatMap((byPax) => Object.values(byPax));

/** Saved seats of a booking (after a refresh). */
export function selectionFromBooking(ancillaries: PublicBookingAncillary[]): SeatSelection {
  const selection: SeatSelection = {};
  for (const a of ancillaries) {
    if (a.type !== 'seat' || !a.segmentRef || !a.passengerRef || !a.serviceId) continue;
    (selection[a.segmentRef] ??= {})[a.passengerRef] = { serviceId: a.serviceId, label: a.label, price: a.amount };
  }
  return selection;
}

/** Window = outer seat of the outer sections; aisle = a seat next to the gap between sections. */
export function seatPosition(row: SeatMapRow, sectionIndex: number, elementIndex: number): 'window' | 'aisle' | 'middle' {
  const seatIndexes = row.sections[sectionIndex].elements.flatMap((e, i) => (e.type === 'seat' ? [i] : []));
  const first = seatIndexes[0];
  const last = seatIndexes[seatIndexes.length - 1];
  const lastSection = row.sections.length - 1;
  if ((sectionIndex === 0 && elementIndex === first) || (sectionIndex === lastSection && elementIndex === last)) return 'window';
  if ((sectionIndex > 0 && elementIndex === first) || (sectionIndex < lastSection && elementIndex === last)) return 'aisle';
  return 'middle';
}
