import { offer } from '@/test/fixtures';
import { leadOffers, sortOffers } from './offer-sort';

const a = offer({ amount: '100.10', slices: [{ minutes: 300 }] });
const b = offer({ amount: '100.09', slices: [{ minutes: 120 }] });
const c = offer({ amount: '99.9', slices: [{ minutes: 120 }] }); // fewer decimals on purpose
const supplierOrder = [a, b, c];

describe('sortOffers', () => {
  it('recommended keeps supplier order (and copies the array)', () => {
    const sorted = sortOffers(supplierOrder, 'recommended');
    expect(sorted).toEqual(supplierOrder);
    expect(sorted).not.toBe(supplierOrder);
  });

  it('cheapest compares decimal strings exactly', () => {
    expect(sortOffers(supplierOrder, 'cheapest')).toEqual([c, b, a]);
  });

  it('fastest uses total duration, then price', () => {
    expect(sortOffers(supplierOrder, 'fastest')).toEqual([c, b, a]);
  });

  it('fastest sums all slices of a round trip', () => {
    const rt = offer({ amount: '1.00', slices: [{ minutes: 100 }, { minutes: 100 }] });
    const ow = offer({ amount: '2.00', slices: [{ minutes: 150 }] });
    expect(sortOffers([rt, ow], 'fastest')).toEqual([ow, rt]);
  });

  it('is stable for equal prices', () => {
    const x = offer({ amount: '50.00' });
    const y = offer({ amount: '50.0' });
    expect(sortOffers([x, y], 'cheapest')).toEqual([x, y]);
  });

  it('groups mixed currencies instead of throwing', () => {
    const eur = offer({ amount: '1.00', currency: 'EUR' });
    const usd = offer({ amount: '0.50', currency: 'USD' });
    expect(sortOffers([usd, eur], 'cheapest')).toEqual([eur, usd]);
  });
});

describe('leadOffers', () => {
  it('gives each tab its first offer', () => {
    const leads = leadOffers(supplierOrder);
    expect(leads.recommended).toBe(a);
    expect(leads.cheapest).toBe(c);
    expect(leads.fastest).toBe(c);
  });
  it('is empty for no offers', () => {
    expect(leadOffers([]).cheapest).toBeUndefined();
  });
});
