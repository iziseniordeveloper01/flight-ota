import type {
  AirportSearchResponse,
  AirportSuggestion,
  AncillariesResponse,
  ApiErrorBody,
  BookingErrorBody,
  BookingErrorCode,
  BookingResponse,
  CreateBookingResponse,
  OfferResponse,
  SeatMapsResponse,
  UpdateBookingDetailsInput,
  UpdateBookingDetailsResponse,
  SearchFlightsBody,
  SearchFlightsResponse,
  ValidationIssue,
} from '@ota/contracts';
import { env } from '@/env';
import { messages } from './messages';

export type ApiErrorKind =
  | 'validation' // 400
  | 'not_found' // 404
  | 'expired' // 410 offer / booking gone
  | 'conflict' // 409 (booking state moved on)
  | 'rejected' // 422 business rule (code + issues in `body`)
  | 'forbidden' // 403
  | 'timeout' // 504 or our own client timeout
  | 'unavailable' // 502 / 503
  | 'network' // fetch failed (offline, DNS, CORS)
  | 'server'; // anything else

/** Every failure from this client is an ApiError, so UI code can switch on `kind`. */
export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number | null,
    message: string,
    readonly issues: ValidationIssue[] = [],
    /** Bookings API business error body (422/409/410): `code`, `previousTotal`, `serviceIds`… */
    readonly body: BookingErrorBody | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** 4xx: retrying the same request will not help. */
  get code(): BookingErrorCode | undefined {
    return this.body?.code;
  }

  get isClientError(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }
}

// The API gives the supplier 30s; leave headroom so its 504 (with a message) normally wins.
const FLIGHT_TIMEOUT_MS = 35_000;
const AIRPORT_TIMEOUT_MS = 8_000;

function kindForStatus(status: number): ApiErrorKind {
  if (status === 400) return 'validation';
  if (status === 404) return 'not_found';
  if (status === 410) return 'expired';
  if (status === 409) return 'conflict';
  if (status === 422) return 'rejected';
  if (status === 403) return 'forbidden';
  if (status === 504) return 'timeout';
  if (status === 502 || status === 503) return 'unavailable';
  return 'server';
}

const KIND_MESSAGE: Record<ApiErrorKind, string> = {
  validation: messages.errors.validation,
  not_found: messages.errors.notFound,
  expired: messages.errors.expired,
  conflict: messages.errors.server,
  rejected: messages.errors.validation,
  forbidden: messages.errors.server,
  timeout: messages.errors.timeout,
  unavailable: messages.errors.unavailable,
  network: messages.errors.network,
  server: messages.errors.server,
};

async function toApiError(res: Response): Promise<ApiError> {
  const kind = kindForStatus(res.status);
  const body = (await res.json().catch(() => null)) as (ApiErrorBody & Partial<BookingErrorBody>) | null;
  const issues = Array.isArray(body?.issues) ? body.issues : [];
  const business = body && typeof body.code === 'string' ? (body as BookingErrorBody) : null;
  // 400: the first concrete field message. Booking business errors: the API's message (written for
  // customers). Anything else: our own friendly copy.
  const message =
    kind === 'validation' && issues[0]
      ? issues[0].message
      : business && typeof business.message === 'string'
        ? business.message
        : KIND_MESSAGE[kind];
  return new ApiError(kind, res.status, message, issues, business);
}

async function request<T>(
  url: string,
  { timeoutMs, signal, ...init }: RequestInit & { timeoutMs: number },
): Promise<T> {
  // Abort on whichever comes first: our deadline or the caller (React Query cancels stale queries).
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: combined,
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch (err) {
    if (timeout.aborted) throw new ApiError('timeout', null, KIND_MESSAGE.timeout);
    // Caller cancelled: rethrow untouched so React Query treats it as a cancellation.
    if (signal?.aborted) throw err;
    throw new ApiError('network', null, KIND_MESSAGE.network);
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export const api = {
  async searchAirports(q: string, signal?: AbortSignal): Promise<AirportSuggestion[]> {
    const qs = new URLSearchParams({ q, limit: '8' });
    const res = await request<AirportSearchResponse>(`${env.NEXT_PUBLIC_API_URL}/airports?${qs}`, {
      signal,
      timeoutMs: AIRPORT_TIMEOUT_MS,
    });
    return res.data;
  },

  searchFlights(body: SearchFlightsBody, signal?: AbortSignal): Promise<SearchFlightsResponse> {
    return request<SearchFlightsResponse>(`${env.NEXT_PUBLIC_API_URL}/flights/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      timeoutMs: FLIGHT_TIMEOUT_MS,
    });
  },

  getOffer(id: string, signal?: AbortSignal): Promise<OfferResponse> {
    return request<OfferResponse>(`${env.NEXT_PUBLIC_API_URL}/flights/offers/${encodeURIComponent(id)}`, {
      signal,
      timeoutMs: FLIGHT_TIMEOUT_MS,
    });
  },
};

// Bookings go through our own Next route handlers (BFF): they hold the guest token in an httpOnly
// cookie and add it server-side. Same-origin relative URLs, so the cookie is sent automatically.
const BOOKING_TIMEOUT_MS = 40_000;
// The API waits up to 130s for the airline; the route handler up to 150s.
const CONFIRM_TIMEOUT_MS = 160_000;
const bookingUrl = (id: string, action?: string) =>
  `/api/bookings/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const bookingApi = {
  create(offerId: string): Promise<Omit<CreateBookingResponse, 'meta'> & { meta: Omit<CreateBookingResponse['meta'], 'guestToken'> }> {
    return request('/api/bookings', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ offerId }),
      timeoutMs: FLIGHT_TIMEOUT_MS,
    });
  },

  get(id: string, signal?: AbortSignal): Promise<BookingResponse> {
    return request(bookingUrl(id), { signal, timeoutMs: BOOKING_TIMEOUT_MS });
  },

  ancillaries(id: string, signal?: AbortSignal): Promise<AncillariesResponse> {
    return request(bookingUrl(id, 'ancillaries'), { signal, timeoutMs: BOOKING_TIMEOUT_MS });
  },

  seatMaps(id: string, signal?: AbortSignal): Promise<SeatMapsResponse> {
    return request(bookingUrl(id, 'seat-maps'), { signal, timeoutMs: BOOKING_TIMEOUT_MS });
  },

  updateDetails(id: string, body: UpdateBookingDetailsInput): Promise<UpdateBookingDetailsResponse> {
    return request(bookingUrl(id, 'details'), {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
      timeoutMs: BOOKING_TIMEOUT_MS,
    });
  },

  checkout(id: string): Promise<BookingResponse> {
    return request(bookingUrl(id, 'checkout'), { method: 'POST', timeoutMs: BOOKING_TIMEOUT_MS });
  },

  /** 200 settled, 202 still CONFIRMING (poll `get`). Both resolve with the booking. */
  confirmDemo(id: string): Promise<BookingResponse> {
    return request(bookingUrl(id, 'confirm-demo'), { method: 'POST', timeoutMs: CONFIRM_TIMEOUT_MS });
  },
};
