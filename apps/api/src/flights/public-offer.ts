import type { SupplierOffer } from '@ota/contracts';
import type { FlightOffer } from '@ota/suppliers';

/**
 * Strip server-only supplier context (booking tokens, passenger ids). Every offer that leaves the
 * API goes through this — via PricingService.publicOffers(), which also adds `displayPrice`.
 */
export function toPublicOffer<T extends FlightOffer>(offer: T): SupplierOffer<T> {
  const { supplierRef: _supplierRef, ...rest } = offer;
  return rest;
}
