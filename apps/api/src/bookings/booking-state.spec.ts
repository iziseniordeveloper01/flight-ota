import { BookingStatus } from '@ota/db';
import { ALLOWED_TRANSITIONS, assertTransition, canTransition, IllegalTransitionError } from './booking-state.js';

const ALL = Object.values(BookingStatus);
const ALLOWED: Array<[BookingStatus, BookingStatus]> = [
  ['DRAFT', 'PENDING_PAYMENT'],
  ['DRAFT', 'EXPIRED'],
  ['PENDING_PAYMENT', 'CONFIRMING'],
  ['PENDING_PAYMENT', 'EXPIRED'],
  ['CONFIRMING', 'CONFIRMED'],
  ['CONFIRMING', 'FAILED'],
  ['CONFIRMED', 'CANCELLED'],
];
const key = (from: string, to: string) => `${from}→${to}`;
const allowedKeys = new Set(ALLOWED.map(([f, t]) => key(f, t)));
const ILLEGAL = ALL.flatMap((from) => ALL.map((to) => [from, to] as [BookingStatus, BookingStatus])).filter(
  ([f, t]) => !allowedKeys.has(key(f, t)),
);

describe('booking state machine', () => {
  it('the table contains exactly the specified transitions', () => {
    const table = Object.entries(ALLOWED_TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => key(from, to)));
    expect(new Set(table)).toEqual(allowedKeys);
  });

  it.each(ALLOWED)('%s → %s is allowed', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each(ILLEGAL)('%s → %s is illegal', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(IllegalTransitionError);
  });

  it('covers every status pair (7 × 7)', () => {
    expect(ALLOWED.length + ILLEGAL.length).toBe(49);
  });
});
