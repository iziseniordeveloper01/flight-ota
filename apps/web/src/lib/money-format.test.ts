import { formatMinor, formatMoney, moneyToMinor } from './money-format';

describe('formatMoney', () => {
  it('formats decimal strings with the offer currency', () => {
    expect(formatMoney({ amount: '402', currency: 'USD' })).toBe('$402.00');
    expect(formatMoney({ amount: '402.5', currency: 'USD' })).toBe('$402.50');
    expect(formatMoney({ amount: '1234.56', currency: 'GBP' })).toBe('£1,234.56');
  });

  it('uses each currency’s own decimals', () => {
    expect(formatMoney({ amount: '15000', currency: 'JPY' })).toBe('JP¥15,000');
  });

  it('keeps precision a float would lose', () => {
    // 2^53 + 1: not representable as a double; the string path formats it exactly
    // (en-IN groups digits in lakhs/crores).
    expect(formatMoney({ amount: '9007199254740993.01', currency: 'USD' })).toBe('$9,00,71,99,25,47,40,993.01');
  });
});

describe('minor units', () => {
  it('converts exactly via BigInt', () => {
    expect(moneyToMinor({ amount: '0.30', currency: 'USD' })).toBe(30n);
    expect(moneyToMinor({ amount: '10.5', currency: 'USD' })).toBe(1050n);
    expect(moneyToMinor({ amount: '15000', currency: 'JPY' })).toBe(15000n);
  });
  it('formats minor units back', () => {
    expect(formatMinor(1050n, 'USD')).toBe('$10.50');
  });
});
