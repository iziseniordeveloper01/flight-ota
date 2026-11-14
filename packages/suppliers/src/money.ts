import type { Money } from './types.js';

// Decimal-string money helpers. Everything goes through BigInt so no value ever passes through
// a binary float (0.1 + 0.2 !== 0.3).

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Number of minor-unit digits for a currency: USD 2, JPY 0, KWD 3. */
export function currencyDigits(currency: string): number {
  // Intl knows ISO 4217 minor units; throws RangeError for malformed codes.
  // `?? 2` only satisfies the lib typing; style 'currency' always resolves a value.
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

/** "12.3" with 2 digits → 1230n. Throws on non-decimal input or more precision than `digits`. */
export function toMinor(amount: string, digits: number): bigint {
  if (!DECIMAL.test(amount)) throw new Error(`Invalid money amount: "${amount}"`);
  const negative = amount.startsWith('-');
  const [int, frac = ''] = amount.replace('-', '').split('.');
  // Trailing zeros beyond `digits` are harmless ("10.500" in USD); real extra precision is not.
  const trimmed = frac.replace(/0+$/, '');
  if (trimmed.length > digits) throw new Error(`Amount "${amount}" has more than ${digits} decimals`);
  const value = BigInt(int + frac.padEnd(digits, '0').slice(0, digits));
  return negative ? -value : value;
}

/** 1230n with 2 digits → "12.30". */
export function fromMinor(minor: bigint, digits: number): string {
  const negative = minor < 0n;
  const abs = (negative ? -minor : minor).toString().padStart(digits + 1, '0');
  const int = abs.slice(0, abs.length - digits);
  const frac = abs.slice(abs.length - digits);
  return `${negative ? '-' : ''}${int}${digits > 0 ? `.${frac}` : ''}`;
}

/** Build Money from minor units in the currency's own precision. */
export function moneyFromMinor(minor: bigint, currency: string): Money {
  return { amount: fromMinor(minor, currencyDigits(currency)), currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  // Comparing 100 USD with 100 EUR is meaningless — fail loudly instead of guessing.
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

// Compare at the larger scale of the two strings, so "10.5" and "10.50" are equal.
function scaled(a: Money, b: Money): [bigint, bigint] {
  const digits = Math.max(decimals(a.amount), decimals(b.amount));
  return [toMinor(a.amount, digits), toMinor(b.amount, digits)];
}

function decimals(amount: string): number {
  return amount.split('.')[1]?.length ?? 0;
}

/** -1 / 0 / 1. Throws if currencies differ. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  const [x, y] = scaled(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Sum in `currency` at its own precision. Throws on a currency mismatch or excess precision. */
export function sumMoney(items: Money[], currency: string): Money {
  const digits = currencyDigits(currency);
  let total = 0n;
  for (const item of items) {
    if (item.currency !== currency) throw new Error(`Currency mismatch: ${item.currency} vs ${currency}`);
    total += toMinor(item.amount, digits);
  }
  return { amount: fromMinor(total, digits), currency };
}

/** `unit` × an integer quantity. */
export function multiplyMoney(unit: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) throw new Error(`Quantity must be an integer: ${quantity}`);
  const digits = currencyDigits(unit.currency);
  return { amount: fromMinor(toMinor(unit.amount, digits) * BigInt(quantity), digits), currency: unit.currency };
}

/**
 * Re-pricing result. No previous total → unchanged. Throws if currencies differ: a currency
 * switch between search and re-price must surface as an error, never as "same price".
 */
export function priceChange(
  previous: Money | undefined,
  current: Money,
): { priceChanged: boolean; previousTotal?: Money } {
  if (!previous) return { priceChanged: false };
  return compareMoney(previous, current) === 0
    ? { priceChanged: false }
    : { priceChanged: true, previousTotal: previous };
}
