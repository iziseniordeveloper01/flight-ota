import 'server-only';
import type {
  AirportSearchResponse,
  AirportSuggestion,
  BookingResponse,
  OfferResponse,
  PublicAncillaries,
  PublicBooking,
} from '@ota/contracts';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { bookingCookieName, isBookingId } from './booking-cookie';
import { serverEnv } from './env';

// Server-side calls to the API: route handlers (BFF) and server components. The guest token only
// ever travels server → API, as X-Booking-Token; the browser holds it in an httpOnly cookie.

const DEFAULT_TIMEOUT_MS = 35_000;
// The API waits up to 130s for the airline on confirm; leave room for its own answer.
export const CONFIRM_TIMEOUT_MS = 150_000;

/** Fetch `${API_INTERNAL_URL}${path}` — the path is always built by us, never taken from a request. */
export function apiFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  return fetch(`${serverEnv.API_INTERNAL_URL}${path}`, {
    ...rest,
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/json', ...rest.headers },
  });
}

export async function bookingToken(bookingId: string): Promise<string | undefined> {
  if (!isBookingId(bookingId)) return undefined;
  return (await cookies()).get(bookingCookieName(bookingId))?.value;
}

/** A booking call with the token from the cookie; `null` when there is no cookie for this booking. */
export async function bookingFetch(
  bookingId: string,
  suffix: '' | '/ancillaries' | '/seat-maps' | '/details' | '/checkout' | '/confirm-demo' | '/payment-order' | '/payment-verify',
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response | null> {
  const token = await bookingToken(bookingId);
  if (!token) return null;
  return apiFetch(`/bookings/${bookingId}${suffix}`, {
    ...init,
    headers: { ...init.headers, 'X-Booking-Token': token },
  });
}

// ------------------------------------------------------------------------------------------------
// Server components: first render without a client waterfall. Missing cookie / 404 → not-found page.

async function pageJson<T>(res: Response | null): Promise<T> {
  if (!res || res.status === 404) notFound();
  if (!res.ok) throw new Error(`Booking API responded ${res.status}`);
  return (await res.json()) as T;
}

export async function getBookingForPage(bookingId: string): Promise<PublicBooking> {
  return (await pageJson<BookingResponse>(await bookingFetch(bookingId, ''))).data;
}

/** `null` when the booking expired meanwhile (410): the page shows the expired dialog. */
export async function getAncillariesForPage(bookingId: string): Promise<PublicAncillaries | null> {
  const res = await bookingFetch(bookingId, '/ancillaries');
  if (res?.status === 410) return null;
  return (await pageJson<{ data: PublicAncillaries }>(res)).data;
}

/** Re-priced offer for the trip summary. `null` = gone (410/404): show the expired state. */
export async function getOfferForPage(offerId: string): Promise<OfferResponse | null> {
  const res = await apiFetch(`/flights/offers/${encodeURIComponent(offerId)}`);
  if (res.status === 410 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Offer API responded ${res.status}`);
  return (await res.json()) as OfferResponse;
}

/**
 * Display names for airport codes (trip summary only, before a booking exists). Best effort:
 * a failed lookup just leaves the code without a name. No business rules use this.
 */
export async function airportNames(codes: string[]): Promise<Record<string, AirportSuggestion>> {
  const entries = await Promise.all(
    [...new Set(codes)].map(async (code) => {
      try {
        const res = await apiFetch(`/airports?${new URLSearchParams({ q: code, limit: '1' })}`, { timeoutMs: 5_000 });
        if (!res.ok) return null;
        const match = ((await res.json()) as AirportSearchResponse).data.find((a) => a.iataCode === code);
        return match ? ([code, match] as const) : null;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((e) => e !== null));
}
