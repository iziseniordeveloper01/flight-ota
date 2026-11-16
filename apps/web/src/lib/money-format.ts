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

const nameFormatters = new Map<string, Intl.NumberFormat>();

/** "20.00 US dollars": for screen-reader labels, where "$20.00" can be read ambiguously. */
export function formatMoneyWords(money: Money): string {
  let f = nameFormatters.get(money.currency);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: money.currency, currencyDisplay: 'name' });
    nameFormatters.set(money.currency, f);
  }
  return f.format(money.amount as Intl.StringNumericLiteral);
}

/** Integer minor units (e.g. cents) for range filters. Exact: BigInt, no floats. */
export function moneyToMinor(money: Money): bigint {
  return toMinor(money.amount, currencyDigits(money.currency));
}

export function formatMinor(minor: bigint, currency: string): string {
  return formatMoney({ amount: fromMinor(minor, currencyDigits(currency)), currency });
}
