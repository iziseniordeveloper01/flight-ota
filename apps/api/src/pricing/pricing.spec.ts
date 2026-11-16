import { convert, identitySnapshot, normalizeRate, priceQuote, type FxSnapshot, type Markup } from './pricing.js';

const fx = (base: string, rate: string, bufferPercent = '2'): FxSnapshot => ({
  base,
  quote: 'INR',
  rate,
  bufferPercent,
  source: 'test',
  fetchedAt: '2026-11-16T00:00:00.000Z',
});
const NO_MARKUP: Markup = { fixedMinor: 0n, percent: '0' };
const m = (amount: string, currency: string) => ({ amount, currency });

describe('convert (supplier → INR)', () => {
  it('rate × (1 + buffer), rounded UP to the whole rupee', () => {
    expect(convert(m('100.00', 'USD'), fx('USD', '83.5'), NO_MARKUP)).toEqual(m('8517.00', 'INR')); // exactly 8517
    expect(convert(m('100.01', 'USD'), fx('USD', '83.5'), NO_MARKUP)).toEqual(m('8518.00', 'INR')); // 8517.85… → up
    expect(convert(m('0.01', 'USD'), fx('USD', '83.5'), NO_MARKUP)).toEqual(m('1.00', 'INR'));
    expect(convert(m('0.00', 'USD'), fx('USD', '83.5'), NO_MARKUP)).toEqual(m('0.00', 'INR'));
  });

  it('handles currencies with 0 and 3 minor digits', () => {
    expect(convert(m('1000', 'JPY'), fx('JPY', '0.55'), NO_MARKUP)).toEqual(m('561.00', 'INR'));
    expect(convert(m('10.500', 'KWD'), fx('KWD', '271.12345678'), NO_MARKUP)).toEqual(m('2904.00', 'INR'));
  });

  it('same currency passes through exactly: no buffer, paise kept', () => {
    expect(convert(m('4999.50', 'INR'), identitySnapshot('INR'), NO_MARKUP)).toEqual(m('4999.50', 'INR'));
    // Even if a snapshot carried a buffer, INR amounts are never buffered.
    expect(convert(m('4999.50', 'INR'), fx('USD', '83.5'), NO_MARKUP)).toEqual(m('4999.50', 'INR'));
  });

  it('is decimal-exact (never a float): 0.07 × 100 is 7, not 7.000000000000001 → 8', () => {
    expect(0.07 * 100).not.toBe(7); // the float trap this guards against
    expect(convert(m('0.07', 'USD'), fx('USD', '100', '0'), NO_MARKUP)).toEqual(m('7.00', 'INR'));
    expect(convert(m('19.99', 'USD'), fx('USD', '1.1', '0'), NO_MARKUP)).toEqual(m('22.00', 'INR')); // 21.989 → up
  });

  it('applies markup percent then fixed (paise), then rounds', () => {
    const markup: Markup = { fixedMinor: 10_000n, percent: '1.5' };
    expect(convert(m('1000.00', 'INR'), identitySnapshot('INR'), markup)).toEqual(m('1115.00', 'INR'));
    // 10 USD → 851.7 × 1.015 = 864.4755 + 100 = 964.4755 → 965
    expect(convert(m('10.00', 'USD'), fx('USD', '83.5'), markup)).toEqual(m('965.00', 'INR'));
  });

  it('rejects another currency than the snapshot base, and negative amounts', () => {
    expect(() => convert(m('1.00', 'EUR'), fx('USD', '83.5'), NO_MARKUP)).toThrow(/Cannot convert EUR/);
    expect(() => convert(m('-1.00', 'USD'), fx('USD', '83.5'), NO_MARKUP)).toThrow(/Negative/);
  });
});

describe('priceQuote', () => {
  it('line() never adds markup; fare() does and reports it separately', () => {
    const q = priceQuote(fx('USD', '83.5'), { fixedMinor: 10_000n, percent: '1.5' }, 'INR');
    expect(q.line(m('10.00', 'USD'))).toEqual(m('852.00', 'INR'));
    expect(q.fare(m('10.00', 'USD'))).toEqual({ charge: m('965.00', 'INR'), markup: m('113.00', 'INR') });
  });

  it('markup 0 (the default) → markup amount 0', () => {
    expect(priceQuote(fx('USD', '83.5'), NO_MARKUP, 'INR').fare(m('100.01', 'USD'))).toEqual({ charge: m('8518.00', 'INR'), markup: m('0.00', 'INR') });
  });

  it('refuses a snapshot for another charge currency', () => {
    expect(() => priceQuote({ ...fx('USD', '83.5'), quote: 'EUR' }, NO_MARKUP, 'INR')).toThrow(/charge currency/);
  });
});

describe('normalizeRate', () => {
  it('keeps the shortest decimal form, ≤ 8 decimals (half-up)', () => {
    expect(normalizeRate(94.11)).toBe('94.11');
    expect(normalizeRate(1)).toBe('1');
    expect(normalizeRate(0.0123456789)).toBe('0.01234568');
    expect(normalizeRate(83.123456784)).toBe('83.12345678');
  });

  it('rejects zero, negatives, NaN and exponent forms', () => {
    expect(() => normalizeRate(0)).toThrow();
    expect(() => normalizeRate(-1)).toThrow();
    expect(() => normalizeRate(Number.NaN)).toThrow();
    expect(() => normalizeRate(1e-7)).toThrow(/Unsupported/);
  });
});
