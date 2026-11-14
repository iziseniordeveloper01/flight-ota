import { currencyDigits, fromMinor, toMinor, type Money } from '@ota/contracts';
import { LOCALE } from './messages';

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string): Intl.NumberFormat {
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { style: 'currency', currency });
    formatters.set(currency, f);
  }
  return f;
}

/**
 * { amount: "402.5", currency: "USD" } → "$402.50".
 * Intl.NumberFormat.format accepts a decimal STRING and formats it exactly, so the amount never
 * passes through a binary float (no 0.1 + 0.2 surprises).
 */
export function formatMoney(money: Money): string {
  return formatter(money.currency).format(money.amount as Intl.StringNumericLiteral);
}

/** Integer minor units (e.g. cents) for range filters. Exact: BigInt, no floats. */
export function moneyToMinor(money: Money): bigint {
  return toMinor(money.amount, currencyDigits(money.currency));
}

export function formatMinor(minor: bigint, currency: string): string {
  return formatMoney({ amount: fromMinor(minor, currencyDigits(currency)), currency });
}
