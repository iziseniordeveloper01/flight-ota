import { isAbortError } from '../call.js';
import { SupplierError, type SupplierErrorCode } from '../errors.js';
import type { ApiResponseError } from './duffel.types.js';

// Duffel error codes meaning "this offer can no longer be booked/priced".
const EXPIRED_CODES = new Set(['offer_no_longer_available', 'offer_expired']);

/** Map an HTTP error response from Duffel to our SupplierError. */
export function fromDuffelResponse(
  status: number,
  errors: ApiResponseError[] = [],
  requestId?: string,
): SupplierError {
  const first = errors[0];
  const code = classify(status, errors);
  // Only Duffel's own error title/code and request id: safe to log, useful for Duffel support.
  const detail = first ? `${first.title} (${first.code})` : 'no error body';
  const ref = requestId ? ` [request_id ${requestId}]` : '';
  return new SupplierError(code, 'duffel', `Duffel HTTP ${status}: ${detail}${ref}`, {
    cause: errors.length ? errors : undefined,
  });
}

/** Map a thrown fetch error (abort, timeout, DNS, connection reset...) to our SupplierError. */
export function fromDuffelThrown(err: unknown): SupplierError {
  if (err instanceof SupplierError) return err;
  if (isAbortError(err)) {
    return new SupplierError('TIMEOUT', 'duffel', 'Duffel request timed out or was aborted', {
      cause: err,
    });
  }
  // fetch() rejects with TypeError on network failures. Its message never contains our headers.
  if (err instanceof TypeError) {
    return new SupplierError('UNAVAILABLE', 'duffel', `Duffel unreachable: ${err.message}`, {
      cause: err,
    });
  }
  return new SupplierError('UPSTREAM_ERROR', 'duffel', 'Unexpected Duffel failure', { cause: err });
}

function classify(status: number, errors: ApiResponseError[]): SupplierErrorCode {
  // Checked first: an expired offer may come back as 404/422, and "expired" is the more useful answer.
  if (errors.some((e) => EXPIRED_CODES.has(e.code))) return 'OFFER_EXPIRED';
  if (status === 404 || errors.some((e) => e.code === 'not_found')) return 'OFFER_NOT_FOUND';
  if (status === 400 || status === 422 || errors.some((e) => e.type === 'validation_error')) {
    return 'INVALID_REQUEST';
  }
  // 429: rate limited — temporary, like a 5xx.
  if (status === 429 || status >= 500) return 'UNAVAILABLE';
  return 'UPSTREAM_ERROR';
}
