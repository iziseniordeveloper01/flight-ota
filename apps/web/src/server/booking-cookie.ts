import { bookingIdSchema } from '@ota/contracts';

// Pure helpers for the guest-token cookie (no Next imports, so they are unit-testable).

const DAY_SECONDS = 86_400;

/** One cookie per booking, so several bookings in one browser don't overwrite each other. */
export function bookingCookieName(bookingId: string): string {
  return `bk_${bookingId}`;
}

export function bookingCookieOptions(production: boolean) {
  return {
    httpOnly: true, // never readable by browser JS
    secure: production,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7 * DAY_SECONDS,
  };
}

/**
 * The confirm-demo Idempotency-Key, derived from the booking id: double clicks, a refresh or a
 * second tab always send the same key, so the API replays the first result instead of booking twice.
 * It is not a secret (the guest token is what authorises the call).
 */
export function confirmIdempotencyKey(bookingId: string): string {
  return `confirm-${bookingId}`;
}

export function isBookingId(value: string): boolean {
  return bookingIdSchema.safeParse(value).success;
}
