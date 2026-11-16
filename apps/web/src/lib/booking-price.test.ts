import { priceBreakdown } from './booking-price';

const usd = (amount: string) => ({ amount, currency: 'USD' });

describe('priceBreakdown', () => {
  it('adds fare, bags, seats and insurance exactly (no float drift)', () => {
    const p = priceBreakdown({ fare: usd('0.10'), bags: [usd('0.20'), usd('45.00')], seats: [usd('19.99')], insurance: usd('5.01') });
    expect(p).toEqual({ fare: usd('0.10'), baggage: usd('45.20'), seats: usd('19.99'), insurance: usd('5.01'), total: usd('70.30') });
  });

  it('empty extras are zero in the fare currency', () => {
    const p = priceBreakdown({ fare: { amount: '12345', currency: 'JPY' }, bags: [], seats: [], insurance: null });
    expect(p.baggage).toEqual({ amount: '0', currency: 'JPY' });
    expect(p.total).toEqual({ amount: '12345', currency: 'JPY' });
  });

  it('refuses to add another currency', () => {
    expect(() => priceBreakdown({ fare: usd('10.00'), bags: [{ amount: '5.00', currency: 'EUR' }], seats: [], insurance: null })).toThrow();
  });
});
