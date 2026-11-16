import { BookingStatus } from '@ota/db';
import { ALLOWED_TRANSITIONS, assertTransition, canTransition, IllegalTransitionError } from './booking-state.js';

const ALL = Object.values(BookingStatus);
const ALLOWED: Array<[BookingStatus, BookingStatus]> = [
  ['DRAFT', 'PENDING_PAYMENT'],
  ['DRAFT', 'EXPIRED'],
  ['PENDING_PAYMENT', 'PAID'],
  ['PENDING_PAYMENT', 'EXPIRED'],
  ['PAID', 'CONFIRMING'],
  ['CONFIRMING', 'CONFIRMED'],
  ['CONFIRMING', 'FAILED'],
  ['CONFIRMED', 'CANCELLED'],
  ['FAILED', 'REFUND_PENDING'],
  ['EXPIRED', 'REFUND_PENDING'],
  ['REFUND_PENDING', 'REFUNDED'],
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

  it('covers every status pair (10 × 10)', () => {
    expect(ALL).toHaveLength(10);
    expect(ALLOWED.length + ILLEGAL.length).toBe(100);
  });

  it('money never skips PAID and a refund needs a terminal failure first', () => {
    expect(canTransition('PENDING_PAYMENT', 'CONFIRMING')).toBe(false);
    expect(canTransition('CONFIRMED', 'REFUND_PENDING')).toBe(false);
    expect(canTransition('PAID', 'REFUND_PENDING')).toBe(false);
  });
});
