import { describe, expect, it } from 'vitest';
import {
  compareMoney,
  currencyDigits,
  fromMinor,
  moneyFromMinor,
  multiplyMoney,
  priceChange,
  sumMoney,
  toMinor,
} from './money.js';

const usd = (amount: string) => ({ amount, currency: 'USD' });

describe('money', () => {
  it('sums and multiplies exactly in the currency precision', () => {
    expect(sumMoney([usd('0.10'), usd('0.20'), usd('10')], 'USD')).toEqual(usd('10.30'));
    expect(sumMoney([], 'JPY')).toEqual({ amount: '0', currency: 'JPY' });
    expect(() => sumMoney([usd('1.00'), { amount: '1.00', currency: 'EUR' }], 'USD')).toThrow(/mismatch/);
    expect(() => sumMoney([usd('1.005')], 'USD')).toThrow(/decimals/);
    expect(multiplyMoney(usd('19.99'), 3)).toEqual(usd('59.97'));
    expect(multiplyMoney({ amount: '1.250', currency: 'KWD' }, 2)).toEqual({ amount: '2.500', currency: 'KWD' });
    expect(() => multiplyMoney(usd('1.00'), 1.5)).toThrow();
  });

  it('knows minor units per currency', () => {
    expect(currencyDigits('USD')).toBe(2);
    expect(currencyDigits('JPY')).toBe(0);
    expect(currencyDigits('KWD')).toBe(3);
  });

  it('round-trips minor units without floats', () => {
    expect(toMinor('12.3', 2)).toBe(1230n);
    expect(toMinor('-0.05', 2)).toBe(-5n);
    expect(fromMinor(1230n, 2)).toBe('12.30');
    expect(fromMinor(5n, 2)).toBe('0.05');
    expect(fromMinor(-5n, 2)).toBe('-0.05');
    expect(fromMinor(1500n, 0)).toBe('1500');
    expect(moneyFromMinor(30n, 'USD')).toEqual(usd('0.30'));
  });

  it('rejects malformed or over-precise amounts', () => {
    expect(() => toMinor('1e3', 2)).toThrow();
    expect(() => toMinor('12.', 2)).toThrow();
    expect(() => toMinor('123.4500000001', 2)).toThrow();
    expect(toMinor('10.500', 2)).toBe(1050n); // trailing zeros are fine
  });

  it('compares decimals exactly, regardless of scale', () => {
    expect(compareMoney(usd('10.5'), usd('10.50'))).toBe(0);
    expect(compareMoney(usd('9.99'), usd('10'))).toBe(-1);
    expect(compareMoney(usd('100.01'), usd('100.009'))).toBe(1);
    // A float would round these to the same value.
    expect(compareMoney(usd('0.30000000000000001'), usd('0.3'))).toBe(1);
  });

  it('throws on currency mismatch instead of comparing', () => {
    expect(() => compareMoney(usd('1.00'), { amount: '1.00', currency: 'EUR' })).toThrow(/mismatch/);
    expect(() => priceChange(usd('1.00'), { amount: '1.00', currency: 'EUR' })).toThrow(/mismatch/);
  });

  it('priceChange reports the previous total only when it differs', () => {
    expect(priceChange(undefined, usd('10.00'))).toEqual({ priceChanged: false });
    expect(priceChange(usd('10'), usd('10.00'))).toEqual({ priceChanged: false });
    expect(priceChange(usd('10.00'), usd('11.20'))).toEqual({
      priceChanged: true,
      previousTotal: usd('10.00'),
    });
  });
});
