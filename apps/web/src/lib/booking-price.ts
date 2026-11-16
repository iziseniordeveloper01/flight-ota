import { sumMoney, type Money, type PublicBooking } from '@ota/contracts';

export interface PriceBreakdown {
  fare: Money;
  baggage: Money;
  seats: Money;
  insurance: Money;
  total: Money;
}

/**
 * Live total while the customer picks extras, before anything is saved. Decimal-exact (BigInt minor
 * units via sumMoney). After PUT/checkout the server's price is authoritative and shown instead.
 * Throws on a currency mismatch (sumMoney) — the API rejects such a selection too.
 */
export function priceBreakdown(input: { fare: Money; bags: Money[]; seats: Money[]; insurance: Money | null }): PriceBreakdown {
  const { currency } = input.fare;
  const baggage = sumMoney(input.bags, currency);
  const seats = sumMoney(input.seats, currency);
  const insurance = sumMoney(input.insurance ? [input.insurance] : [], currency);
  return { fare: input.fare, baggage, seats, insurance, total: sumMoney([input.fare, baggage, seats, insurance], currency) };
}

/** A saved booking's breakdown (review / complete): split bags vs seats; the total is the server's. */
export function bookingBreakdown(booking: Pick<PublicBooking, 'price' | 'ancillaries'>): PriceBreakdown {
  const amounts = (type: 'bag' | 'seat') => booking.ancillaries.filter((a) => a.type === type).map((a) => a.amount);
  const insurance = booking.price.insurance;
  return {
    ...priceBreakdown({ fare: booking.price.fare, bags: amounts('bag'), seats: amounts('seat'), insurance }),
    total: booking.price.total,
  };
}
