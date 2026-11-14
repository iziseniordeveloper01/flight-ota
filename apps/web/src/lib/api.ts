import type {
  AirportSearchResponse,
  AirportSuggestion,
  ApiErrorBody,
  OfferResponse,
  SearchFlightsBody,
  SearchFlightsResponse,
  ValidationIssue,
} from '@ota/contracts';
import { env } from '@/env';
import { messages } from './messages';

export type ApiErrorKind =
  | 'validation' // 400
  | 'not_found' // 404
  | 'expired' // 410 offer gone
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
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** 4xx: retrying the same request will not help. */
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
  if (status === 504) return 'timeout';
  if (status === 502 || status === 503) return 'unavailable';
  return 'server';
}

const KIND_MESSAGE: Record<ApiErrorKind, string> = {
  validation: messages.errors.validation,
  not_found: messages.errors.notFound,
  expired: messages.errors.expired,
  timeout: messages.errors.timeout,
  unavailable: messages.errors.unavailable,
  network: messages.errors.network,
  server: messages.errors.server,
};

async function toApiError(res: Response): Promise<ApiError> {
  const kind = kindForStatus(res.status);
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  const issues = Array.isArray(body?.issues) ? body.issues : [];
  // For 400 show the first concrete field message; otherwise our own friendly copy.
  const message = kind === 'validation' && issues[0] ? issues[0].message : KIND_MESSAGE[kind];
  return new ApiError(kind, res.status, message, issues);
}

async function request<T>(
  path: string,
  { timeoutMs, signal, ...init }: RequestInit & { timeoutMs: number },
): Promise<T> {
  // Abort on whichever comes first: our deadline or the caller (React Query cancels stale queries).
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
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
    const res = await request<AirportSearchResponse>(`/airports?${qs}`, {
      signal,
      timeoutMs: AIRPORT_TIMEOUT_MS,
    });
    return res.data;
  },

  searchFlights(body: SearchFlightsBody, signal?: AbortSignal): Promise<SearchFlightsResponse> {
    return request<SearchFlightsResponse>('/flights/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      timeoutMs: FLIGHT_TIMEOUT_MS,
    });
  },

  getOffer(id: string, signal?: AbortSignal): Promise<OfferResponse> {
    return request<OfferResponse>(`/flights/offers/${encodeURIComponent(id)}`, {
      signal,
      timeoutMs: FLIGHT_TIMEOUT_MS,
    });
  },
};
