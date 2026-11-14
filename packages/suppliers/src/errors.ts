import type { Money, SupplierName } from './types.js';

export type SupplierErrorCode =
  | 'TIMEOUT'
  | 'OFFER_EXPIRED'
  | 'OFFER_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'UNAVAILABLE'
  | 'UPSTREAM_ERROR'
  /** createOrder: the supplier's total differs from expectedTotal. */
  | 'PRICE_CHANGED';

/**
 * The only error type adapters may throw. Every supplier-specific failure is mapped to one of
 * these codes so callers can react without knowing which supplier is behind the interface.
 * Messages must never contain credentials or passenger data.
 */
export class SupplierError extends Error {
  /** PRICE_CHANGED only, when known: what the supplier now charges for the same fare + services. */
  readonly newTotal?: Money;

  constructor(
    readonly code: SupplierErrorCode,
    readonly supplier: SupplierName,
    message: string,
    options?: { cause?: unknown; newTotal?: Money },
  ) {
    super(message, options);
    this.name = 'SupplierError';
    this.newTotal = options?.newTotal;
  }
}
