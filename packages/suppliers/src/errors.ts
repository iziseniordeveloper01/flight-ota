import type { SupplierName } from './types.js';

export type SupplierErrorCode =
  | 'TIMEOUT'
  | 'OFFER_EXPIRED'
  | 'OFFER_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'UNAVAILABLE'
  | 'UPSTREAM_ERROR';

/**
 * The only error type adapters may throw. Every supplier-specific failure is mapped to one of
 * these codes so callers can react without knowing which supplier is behind the interface.
 * Messages must never contain credentials or passenger data.
 */
export class SupplierError extends Error {
  constructor(
    readonly code: SupplierErrorCode,
    readonly supplier: SupplierName,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SupplierError';
  }
}
