import type { BookingStatus } from '@ota/db';

/**
 * Booking state machine — the ONLY allowed moves:
 *
 *   DRAFT ──checkout──► PENDING_PAYMENT ──confirm──► CONFIRMING ──► CONFIRMED ──► CANCELLED (future)
 *     │                       │                          └──────► FAILED
 *     └──── lazy expiry ──────┴──► EXPIRED
 *
 * CONFIRMING never expires: an order may exist at the supplier, so it is settled by retrieveOrder.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  DRAFT: ['PENDING_PAYMENT', 'EXPIRED'],
  PENDING_PAYMENT: ['CONFIRMING', 'EXPIRED'],
  CONFIRMING: ['CONFIRMED', 'FAILED'],
  CONFIRMED: ['CANCELLED'],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
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
