import type { InsuranceQuote } from '@ota/contracts';
import { currencyDigits, fromMinor, toMinor, type PassengerType } from '@ota/suppliers';
import type { InsuranceProvider, InsuranceTrip } from './insurance.provider.js';

export const DEMO_QUOTE_ID = 'demo-travel-protection';
const RATE_PERCENT = 3n;
const MIN_PREMIUM_MAJOR = 5n; // 5.00 in the booking currency

/**
 * Clearly-labelled demo insurer: no policy is ever issued. Premium per passenger is 3% of the
 * fare per passenger (fare ÷ passengers), at least 5.00, rounded half-up to the currency's minor unit.
 */
export class DemoInsuranceProvider implements InsuranceProvider {
  readonly name = 'demo';

  async quote(trip: InsuranceTrip, passengers: Array<{ type: PassengerType }>): Promise<InsuranceQuote[]> {
    const count = BigInt(passengers.length);
    if (count === 0n) return [];
    const { currency } = trip.fare;
    const digits = currencyDigits(currency);
    const fareMinor = toMinor(trip.fare.amount, digits);
    // fare × 3% ÷ count, half-up, in integer minor units (no floats).
    const divisor = 100n * count;
    const share = (fareMinor * RATE_PERCENT * 2n + divisor) / (2n * divisor);
    const minimum = MIN_PREMIUM_MAJOR * 10n ** BigInt(digits);
    const perPassenger = share > minimum ? share : minimum;
    return [
      {
        quoteId: DEMO_QUOTE_ID,
        name: 'Travel Protection (Demo)',
        description: 'Demo plan for testing only — no real cover and no policy is issued.',
        pricePerPassenger: { amount: fromMinor(perPassenger, digits), currency },
        total: { amount: fromMinor(perPassenger * count, digits), currency },
        demo: true,
      },
    ];
  }

  async bind(quoteId: string, booking: { reference: string }): Promise<{ policyNumber: string }> {
    if (quoteId !== DEMO_QUOTE_ID) throw new Error(`Unknown demo quote ${quoteId}`);
    // Derived from the booking reference: binding twice yields the same "policy".
    return { policyNumber: `DEMO-${booking.reference}` };
  }
}
