import type { PassengerDetails } from '@ota/contracts';
import type { Ancillaries, SeatMap } from '@ota/suppliers';
import {
  addMonths,
  bookingTotals,
  buildCatalogue,
  checkPassengers,
  lastFlightDate,
  priceServices,
  type PassengerRulesContext,
} from './booking-rules.js';

const usd = (amount: string) => ({ amount, currency: 'USD' });

const person = (ref: string, type: PassengerDetails['type'], dateOfBirth: string, extra: Partial<PassengerDetails> = {}): PassengerDetails => ({
  ref, type, title: 'mr', gender: 'm', givenName: 'Alex', familyName: 'Doe', noFamilyName: false,
  dateOfBirth, nationality: 'GB', document: null, associatedAdultRef: type === 'infant' ? 'p1' : null, ...extra,
});

const ctx: PassengerRulesContext = {
  slots: [{ ref: 'p1', type: 'adult' }, { ref: 'p2', type: 'child' }, { ref: 'p3', type: 'infant' }],
  lastFlightDate: '2026-12-20',
  documentRequired: false,
  maxNameLength: null,
};
const family = [person('p1', 'adult', '1990-01-01'), person('p2', 'child', '2018-01-01'), person('p3', 'infant', '2026-01-01')];
const codes = (r: { issues: Array<{ code: string; path: string }> }) => r.issues.map((i) => `${i.code}@${i.path}`);

describe('lastFlightDate / addMonths', () => {
  it('uses the last segment of the last slice', () => {
    const seg = (departureAt: string) => ({ departureAt }) as never;
    expect(lastFlightDate({ slices: [{ segments: [seg('2026-12-14T10:00:00')] }, { segments: [seg('2026-12-21T23:00:00'), seg('2026-12-22T07:00:00')] }] } as never)).toBe('2026-12-22');
  });

  it('adds months, clamping to month end and crossing years', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonths('2026-12-20', 6)).toBe('2027-06-20');
  });
});

describe('checkPassengers', () => {
  it('a matching family passes with no warnings', () => {
    expect(checkPassengers(family, ctx)).toEqual({ issues: [], warnings: [] });
  });

  it('different passenger mix → PASSENGERS_MISMATCH', () => {
    expect(codes(checkPassengers(family.slice(0, 2), ctx))).toEqual(['PASSENGERS_MISMATCH@passengers']);
    const swapped = [family[0], { ...family[1], type: 'adult' as const }, family[2]];
    expect(codes(checkPassengers(swapped, ctx))).toEqual(['PASSENGERS_MISMATCH@passengers']);
  });

  it('age category is measured on the last flight date (birthday that day counts)', () => {
    // Turns 12 exactly on the last flight → adult, but booked as child.
    const turns12 = [family[0], person('p2', 'child', '2014-12-20'), family[2]];
    expect(codes(checkPassengers(turns12, ctx))).toEqual(['AGE_CATEGORY_MISMATCH@passengers.1.dateOfBirth']);
    // Turns 2 the day after → still an infant.
    const stillInfant = [family[0], family[1], person('p3', 'infant', '2024-12-21')];
    expect(checkPassengers(stillInfant, ctx).issues).toEqual([]);
    // Leap-day baby: 28 Feb is still before the birthday in a non-leap year.
    const leap = checkPassengers([family[0], family[1], person('p3', 'infant', '2024-02-29')], { ...ctx, lastFlightDate: '2026-02-28' });
    expect(leap.issues).toEqual([]);
    const leapAfter = checkPassengers([family[0], family[1], person('p3', 'infant', '2024-02-29')], { ...ctx, lastFlightDate: '2026-03-01' });
    expect(codes(leapAfter)).toEqual(['AGE_CATEGORY_MISMATCH@passengers.2.dateOfBirth']);
    expect(leapAfter.issues[0].message).toMatch(/search again/);
  });

  it('supplier name limit → NAME_TOO_LONG', () => {
    const long = [person('p1', 'adult', '1990-01-01', { givenName: 'A'.repeat(21) }), family[1], family[2]];
    expect(codes(checkPassengers(long, { ...ctx, maxNameLength: 20 }))).toEqual(['NAME_TOO_LONG@passengers.0.givenName']);
    expect(checkPassengers(long, ctx).issues).toEqual([]);
  });

  it('documents: required, must outlive the last flight, warn under 6 months', () => {
    expect(codes(checkPassengers(family, { ...ctx, documentRequired: true }))).toHaveLength(3);
    const passport = (expiryDate: string) => ({ type: 'passport' as const, number: 'X1234567', issuingCountry: 'GB', expiryDate });
    const withPassport = (expiryDate: string) => [person('p1', 'adult', '1990-01-01', { document: passport(expiryDate) }), family[1], family[2]];
    expect(codes(checkPassengers(withPassport('2026-12-20'), ctx))).toEqual(['DOCUMENT_EXPIRED@passengers.0.document.expiryDate']);
    const soon = checkPassengers(withPassport('2027-06-19'), ctx);
    expect(soon.issues).toEqual([]);
    expect(soon.warnings.map((w) => `${w.code}@${w.path}`)).toEqual(['PASSPORT_EXPIRES_SOON@passengers.0.document.expiryDate']);
    expect(checkPassengers(withPassport('2027-06-20'), ctx).warnings).toEqual([]);
  });
});

describe('services pricing', () => {
  const ancillaries: Ancillaries = {
    bags: [{ serviceId: 'bag1', passengerRef: 'p1', segmentRefs: ['s1'], label: '23kg checked bag', weightKg: 23, maxQuantity: 2, price: usd('35.00') }],
    seatsAvailable: true,
    passengerRequirements: { identityDocumentRequired: null, maxNameLength: null },
  };
  const seat = (designator: string, ref: string, amount: string) => ({ passengerRef: ref, serviceId: `seat-${designator}-${ref}`, price: usd(amount) });
  const seatMaps: SeatMap[] = [{
    segmentRef: 's1',
    cabins: [{ deck: 0, rows: [{ number: 14, sections: [{ elements: [
      { type: 'seat', designator: '14A', available: true, services: [seat('14A', 'p1', '12.50'), seat('14A', 'p2', '10.00')] },
      { type: 'seat', designator: '14B', available: true, services: [seat('14B', 'p1', '0.00')] },
    ] }] }] }],
  }];
  const catalogue = buildCatalogue(ancillaries, seatMaps);
  const refs = new Set(['p1', 'p2']);

  it('prices from the catalogue with labels', () => {
    const { lines, issues } = priceServices([{ serviceId: 'bag1', quantity: 2 }, { serviceId: 'seat-14A-p2', quantity: 1 }], catalogue, refs);
    expect(issues).toEqual([]);
    expect(lines.map((l) => [l.label, l.amount.amount])).toEqual([['2 × 23kg checked bag', '70.00'], ['Seat 14A', '10.00']]);
  });

  it.each([
    ['unknown service', [{ serviceId: 'nope', quantity: 1 }], 'services.0.serviceId'],
    ['too many bags', [{ serviceId: 'bag1', quantity: 3 }], 'services.0.quantity'],
    ['two seats for one passenger on one flight', [{ serviceId: 'seat-14A-p1', quantity: 1 }, { serviceId: 'seat-14B-p1', quantity: 1 }], 'services.1.serviceId'],
    ['one seat for two passengers', [{ serviceId: 'seat-14A-p1', quantity: 1 }, { serviceId: 'seat-14A-p2', quantity: 1 }], 'services.1.serviceId'],
  ])('%s → INVALID_SERVICE', (_n, selection, path) => {
    expect(codes(priceServices(selection, catalogue, refs))).toEqual([`INVALID_SERVICE@${path}`]);
  });

  it('a service for a passenger not on the booking is rejected', () => {
    expect(codes(priceServices([{ serviceId: 'seat-14A-p2', quantity: 1 }], catalogue, new Set(['p1'])))).toHaveLength(1);
  });
});

describe('bookingTotals', () => {
  it('adds decimal strings exactly', () => {
    expect(bookingTotals(usd('0.10'), [usd('0.20'), usd('10.05')], usd('5.00'))).toEqual({
      currency: 'USD', fare: usd('0.10'), ancillaries: usd('10.25'), insurance: usd('5.00'), total: usd('15.35'),
    });
    expect(bookingTotals(usd('100.00'), [], null)).toMatchObject({ ancillaries: usd('0.00'), insurance: usd('0.00'), total: usd('100.00') });
  });

  it('throws on a currency mismatch', () => {
    expect(() => bookingTotals(usd('1.00'), [{ amount: '1.00', currency: 'EUR' }], null)).toThrow(/mismatch/);
  });
});
