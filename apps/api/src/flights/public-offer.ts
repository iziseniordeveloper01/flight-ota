import type { FlightOffer } from '@ota/suppliers';

export type PublicOffer<T extends FlightOffer = FlightOffer> = Omit<T, 'supplierRef'>;

/**
 * Strip server-only supplier context (booking tokens, passenger ids) before an offer leaves the
 * API. Every endpoint that returns offers must go through this.
 */
export function toPublicOffer<T extends FlightOffer>(offer: T): PublicOffer<T> {
  const { supplierRef: _supplierRef, ...rest } = offer;
  return rest;
}
