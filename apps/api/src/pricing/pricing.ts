import { currencyDigits, fromMinor, toMinor, type Money } from '@ota/suppliers';

// Pure pricing math: supplier Money → charge Money. BigInt rationals only — no value ever passes
// through a binary float. Unit-tested in pricing.spec.ts.

/** Decimals kept for an exchange rate (matches fx_rates.rate Decimal(18,8)). */
export const RATE_DECIMALS = 8;

/** The exchange rate used for one booking / one response, with where it came from. */
export interface FxSnapshot {
  /** Supplier currency. */
  base: string;
  /** Charge currency. */
  quote: string;
  /** Decimal string, ≤ 8 decimals; "1" when base === quote. */
  rate: string;
  /** Risk buffer in percent ("2" = 2%); "0" when base === quote. */
  bufferPercent: string;
  /** e.g. "frankfurter", "frankfurter:stored", "identity". */
  source: string;
  /** ISO 8601. */
  fetchedAt: string;
}

export interface Markup {
  /** Minor units of the charge currency (paise). */
  fixedMinor: bigint;
  /** Percent string, ≤ 2 decimals. */
  percent: string;
}

/** Converts supplier amounts with one FX snapshot (and the fare markup). */
export interface PriceQuote {
  fx: FxSnapshot;
  chargeCurrency: string;
  /** Bags, seats, previous totals…: rate × (1 + buffer), rounded up. No markup. */
  line(amount: Money): Money;
  /** The fare: converted + markup (percent, then fixed), rounded up. */
  fare(amount: Money): { charge: Money; markup: Money };
}

export function identitySnapshot(currency: string, now = new Date()): FxSnapshot {
  return { base: currency, quote: currency, rate: '1', bufferPercent: '0', source: 'identity', fetchedAt: now.toISOString() };
}

export function priceQuote(fx: FxSnapshot, markup: Markup, chargeCurrency: string): PriceQuote {
  if (fx.quote !== chargeCurrency) throw new Error(`FX quote ${fx.quote} is not the charge currency ${chargeCurrency}`);
  const noMarkup: Markup = { fixedMinor: 0n, percent: '0' };
  return {
    fx,
    chargeCurrency,
    line: (amount) => convert(amount, fx, noMarkup),
    fare: (amount) => {
      const charge = convert(amount, fx, markup);
      const plain = convert(amount, fx, noMarkup);
      return { charge, markup: { amount: fromMinor(toMinor(charge.amount, digitsOf(charge)) - toMinor(plain.amount, digitsOf(plain)), digitsOf(charge)), currency: charge.currency } };
    },
  };
}

/**
 * amount × rate × (1 + buffer%) × (1 + markup%) + fixed markup, in the charge currency.
 * - Cross-currency: rounded UP to the whole currency unit (₹1).
 * - Same currency: passed through exactly (paise kept); with a markup, rounded up to the minor unit.
 */
export function convert(amount: Money, fx: FxSnapshot, markup: Markup): Money {
  const same = amount.currency === fx.quote;
  if (!same && amount.currency !== fx.base) {
    throw new Error(`Cannot convert ${amount.currency} with a ${fx.base}→${fx.quote} rate`);
  }
  const srcDigits = currencyDigits(amount.currency);
  const dstDigits = currencyDigits(fx.quote);
  const src = toMinor(amount.amount, srcDigits);
  if (src < 0n) throw new Error('Negative amounts are not converted');

  const rate = same ? { num: 1n, den: 1n } : decimal(fx.rate, RATE_DECIMALS);
  const buffer = same ? { num: 0n, den: 1n } : decimal(fx.bufferPercent, 2);
  const mk = decimal(markup.percent, 2);

  // Result in destination minor units as num/den:
  //   src/10^s × rate × (100 + buffer)/100 × (100 + mk)/100 × 10^d  +  fixed
  let num = src * rate.num * (100n * buffer.den + buffer.num) * (100n * mk.den + mk.num) * 10n ** BigInt(dstDigits);
  let den = 10n ** BigInt(srcDigits) * rate.den * 100n * buffer.den * 100n * mk.den;
  num += markup.fixedMinor * den;

  const step = same ? 1n : 10n ** BigInt(dstDigits); // round up to this many minor units
  const minor = ceilDiv(num, den * step) * step;
  return { amount: fromMinor(minor, dstDigits), currency: fx.quote };
}

/** "94.11" (≤ maxDecimals) → 9411/100. */
function decimal(value: string, maxDecimals: number): { num: bigint; den: bigint } {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`Invalid decimal "${value}"`);
  return { num: toMinor(value, maxDecimals), den: 10n ** BigInt(maxDecimals) };
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

function digitsOf(m: Money): number {
  return currencyDigits(m.currency);
}

/**
 * A JSON number rate from an FX API → decimal string with ≤ 8 decimals (half-up). The number is
 * read through its shortest decimal representation (String()), never multiplied as a float.
 */
export function normalizeRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Rate must be a positive number');
  const text = String(rate);
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Unsupported rate format "${text}"`);
  const [int, frac = ''] = text.split('.');
  if (frac.length <= RATE_DECIMALS) return text;
  const scaled = BigInt(int + frac.slice(0, RATE_DECIMALS)) + (Number(frac[RATE_DECIMALS]) >= 5 ? 1n : 0n);
  const result = fromMinor(scaled, RATE_DECIMALS).replace(/\.?0+$/, '');
  if (result === '0' || result === '') throw new Error('Rate rounds to zero');
  return result;
}
