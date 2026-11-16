import type { BookingStatus } from '@ota/db';

/**
 * Booking state machine — the ONLY allowed moves:
 *
 *   DRAFT ──checkout──► PENDING_PAYMENT ──paid──► PAID ──► CONFIRMING ──► CONFIRMED ──► CANCELLED (future)
 *     │                       │                                 └──────► FAILED ──┐
 *     └──── lazy expiry ──────┴──► EXPIRED ──(late payment)──► REFUND_PENDING ◄───┘ (money refunded)
 *                                                                   └──► REFUNDED
 *
 * - PAID: money captured, ticketing not started (the ticketing job moves it on).
 * - CONFIRMING never expires: an order may exist at the supplier, so it is settled by retrieveOrder.
 * - REFUND_PENDING is entered only with a captured payment to give back (FAILED without one — e.g.
 *   the demo flow — stays FAILED).
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  DRAFT: ['PENDING_PAYMENT', 'EXPIRED'],
  PENDING_PAYMENT: ['PAID', 'EXPIRED'],
  PAID: ['CONFIRMING'],
  CONFIRMING: ['CONFIRMED', 'FAILED'],
  CONFIRMED: ['CANCELLED'],
  FAILED: ['REFUND_PENDING'],
  EXPIRED: ['REFUND_PENDING'],
  CANCELLED: [],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: [],
};

/** Statuses that become EXPIRED when read after offerExpiresAt. */
export const EXPIRABLE: readonly BookingStatus[] = ['DRAFT', 'PENDING_PAYMENT'];

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: BookingStatus,
    readonly to: BookingStatus,
  ) {
    super(`Illegal booking transition ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
