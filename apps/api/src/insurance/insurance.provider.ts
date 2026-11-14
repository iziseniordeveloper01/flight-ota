import type { InsuranceQuote } from '@ota/contracts';
import type { Money, PassengerType } from '@ota/suppliers';

// Bookings talk to this token, never to a concrete insurer (same pattern as SUPPLIER_ADAPTER).
export const INSURANCE_PROVIDER = Symbol('INSURANCE_PROVIDER');

export interface InsuranceTrip {
  /** Flight fare for all passengers (what the premium is based on). */
  fare: Money;
}

/**
 * Travel insurance partner. Lives in the API, not @ota/suppliers: it isn't flight inventory and a
 * real partner has its own contract, lifecycle and payment flow.
 */
export interface InsuranceProvider {
  readonly name: string;
  /** Plans available for this trip. Prices are recomputed on every call — never trust the client. */
  quote(trip: InsuranceTrip, passengers: Array<{ type: PassengerType }>): Promise<InsuranceQuote[]>;
  /** Issues the policy after the flight is confirmed. Must be idempotent per booking reference. */
  bind(quoteId: string, booking: { reference: string }): Promise<{ policyNumber: string }>;
}
