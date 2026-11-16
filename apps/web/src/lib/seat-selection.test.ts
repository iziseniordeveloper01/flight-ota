import type { OfferPassenger, PublicSeatMapRow } from '@ota/contracts';
import {
  clearSeat,
  findSeat,
  seatChoosers,
  seatPosition,
  seatStatus,
  selectedSeats,
  selectionFromBooking,
  toggleSeat,
  withoutServices,
  type SeatElement,
} from './seat-selection';

const usd = (amount: string) => ({ amount, currency: 'USD' });
const inr = (amount: string) => ({ amount, currency: 'INR' });
const seat = (designator: string, prices: Record<string, string>, available = true): SeatElement => ({
  type: 'seat',
  designator,
  available,
  services: available ? Object.entries(prices).map(([passengerRef, amount]) => ({ passengerRef, serviceId: `${designator}-${passengerRef}`, price: usd(amount), displayPrice: inr(amount) })) : [],
});
const adult1: OfferPassenger = { ref: 'a1', type: 'adult' };
const adult2: OfferPassenger = { ref: 'a2', type: 'adult' };
const infant: OfferPassenger = { ref: 'i1', type: 'infant' };
const SEG = 'seg1';

describe('seat selection rules', () => {
  const free = seat('14A', { a1: '0.00', a2: '0.00' });
  const paid = seat('14C', { a1: '20.00', a2: '15.00' });
  const childOnly = seat('15A', { a2: '0.00' });
  const blocked = seat('15C', {}, false);

  it('status and price depend on the passenger choosing', () => {
    expect(seatStatus(free, SEG, 'a1', {}).status).toBe('free');
    expect(seatStatus(paid, SEG, 'a1', {})).toMatchObject({ status: 'paid', service: { price: usd('20.00') } });
    expect(seatStatus(paid, SEG, 'a2', {}).service?.price).toEqual(usd('15.00'));
    expect(seatStatus(childOnly, SEG, 'a1', {}).status).toBe('unavailable');
    expect(seatStatus(blocked, SEG, 'a1', {}).status).toBe('unavailable');
  });

  it('one seat per passenger per flight: picking another replaces it; tapping again removes it', () => {
    let s = toggleSeat({}, SEG, adult1, free);
    // The selection carries what the customer pays (INR).
    expect(s[SEG].a1).toEqual({ serviceId: '14A-a1', label: 'Seat 14A', price: inr('0.00') });
    s = toggleSeat(s, SEG, adult1, paid);
    expect(Object.keys(s[SEG])).toEqual(['a1']);
    expect(s[SEG].a1.serviceId).toBe('14C-a1');
    expect(seatStatus(paid, SEG, 'a1', s).status).toBe('selected');
    s = toggleSeat(s, SEG, adult1, paid);
    expect(s[SEG].a1).toBeUndefined();
  });

  it("a seat held by another passenger is taken and can't be picked", () => {
    const s = toggleSeat({}, SEG, adult1, paid);
    expect(seatStatus(paid, SEG, 'a2', s).status).toBe('taken');
    expect(toggleSeat(s, SEG, adult2, paid)).toBe(s);
    expect(toggleSeat(s, SEG, adult2, blocked)).toBe(s);
  });

  it('infants never choose seats', () => {
    expect(seatChoosers([adult1, infant, adult2])).toEqual([adult1, adult2]);
    expect(toggleSeat({}, SEG, infant, free)).toEqual({});
  });

  it('flattens, clears, drops unavailable services and restores from a booking', () => {
    const s = toggleSeat(toggleSeat({}, SEG, adult1, free), 'seg2', adult1, paid);
    expect(selectedSeats(s).map((x) => x.serviceId)).toEqual(['14A-a1', '14C-a1']);
    expect(selectedSeats(clearSeat(s, SEG, 'a1')).map((x) => x.serviceId)).toEqual(['14C-a1']);
    expect(selectedSeats(withoutServices(s, ['14C-a1'])).map((x) => x.serviceId)).toEqual(['14A-a1']);
    expect(
      selectionFromBooking([
        { type: 'seat', passengerRef: 'a1', segmentRef: SEG, serviceId: 'x', label: 'Seat 3D', quantity: 1, amount: usd('9.00'), displayAmount: inr('752.00') },
        { type: 'bag', passengerRef: 'a1', segmentRef: null, serviceId: 'b', label: 'bag', quantity: 1, amount: usd('30.00'), displayAmount: inr('2506.00') },
      ]),
    ).toEqual({ [SEG]: { a1: { serviceId: 'x', label: 'Seat 3D', price: inr('752.00') } } });
  });

  it('window / aisle / middle from the row layout (gaps and aisles)', () => {
    const row: PublicSeatMapRow = {
      number: 14,
      sections: [{ elements: [free, paid, { type: 'gap' }, childOnly] }, { elements: [blocked, free, paid] }],
    };
    expect(seatPosition(row, 0, 0)).toBe('window');
    expect(seatPosition(row, 0, 1)).toBe('middle');
    expect(seatPosition(row, 0, 3)).toBe('aisle');
    expect(seatPosition(row, 1, 0)).toBe('aisle');
    expect(seatPosition(row, 1, 2)).toBe('window');
  });

  it('findSeat: designator + position of a selected service (works after a refresh)', () => {
    const row: PublicSeatMapRow = { number: 14, sections: [{ elements: [seat('14A', { a1: '0.00' }), seat('14C', { a1: '20.00', a2: '20.00' })] }, { elements: [seat('14D', { a1: '0.00' })] }] };
    const map = { segmentRef: SEG, cabins: [{ deck: 0, rows: [row] }] };
    expect(findSeat(map, '14C-a2')).toEqual({ designator: '14C', position: 'aisle' });
    expect(findSeat(map, '14A-a1')).toEqual({ designator: '14A', position: 'window' });
    expect(findSeat(map, 'nope')).toBeNull();
  });
});
