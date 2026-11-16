import type { Money, UpdateBookingDetailsInput } from '@ota/contracts';
import { ApiError } from './api';
import { messages } from './messages';

/** What step 1 should do with a failed PUT /details or POST /checkout. */
export interface MappedBookingError {
  /** React Hook Form paths (same as the API's: "passengers.0.dateOfBirth"). */
  fields: Array<{ path: string; message: string }>;
  /** Bag/seat service ids to highlight and ask to re-select. */
  serviceIds: string[];
  insurance: boolean;
  priceChange: { previous: Money; next: Money } | null;
  expired: boolean;
  /** Message for the alert above the Continue button (null = nothing to add). */
  banner: string | null;
}

/** The API puts a missing passport on the document object; our first passport field shows it. */
function fieldPath(path: string): string {
  return /^passengers\.\d+\.document$/.test(path) ? `${path}.number` : path;
}

export function mapBookingError(error: unknown, body: UpdateBookingDetailsInput | null): MappedBookingError {
  const result: MappedBookingError = { fields: [], serviceIds: [], insurance: false, priceChange: null, expired: false, banner: null };
  if (!(error instanceof ApiError)) {
    result.banner = messages.errors.server;
    return result;
  }
  if (error.kind === 'expired') {
    result.expired = true;
    return result;
  }
  const details = error.body;
  if (details?.code === 'PRICE_CHANGED' && details.previousTotal && details.newTotal) {
    result.priceChange = { previous: details.previousTotal, next: details.newTotal };
    return result;
  }
  if (details?.code === 'SERVICE_UNAVAILABLE') {
    const ids = details.serviceIds ?? [];
    result.insurance = Boolean(body?.insurance && ids.includes(body.insurance.quoteId));
    result.serviceIds = ids.filter((id) => id !== body?.insurance?.quoteId);
    result.banner = messages.booking.serviceUnavailable;
    return result;
  }

  for (const issue of error.issues) {
    const path = String(issue.path);
    const service = /^services\.(\d+)\./.exec(path);
    if (path.startsWith('passengers.') || path.startsWith('contact.')) {
      result.fields.push({ path: fieldPath(path), message: issue.message });
    } else if (service) {
      const id = body?.services?.[Number(service[1])]?.serviceId;
      if (id) result.serviceIds.push(id);
    } else if (path.startsWith('insurance')) {
      result.insurance = true;
    } else {
      // e.g. PASSENGERS_MISMATCH at "passengers": the customer must search again.
      result.banner ??= issue.message;
    }
  }
  if (result.serviceIds.length) result.banner ??= messages.booking.serviceUnavailable;
  if (result.fields.length || result.insurance) result.banner ??= messages.booking.fixErrors;
  result.banner ??= error.message;
  return result;
}
