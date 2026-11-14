import { DEMO_QUOTE_ID, DemoInsuranceProvider } from './demo-insurance.provider.js';

const provider = new DemoInsuranceProvider();
const pax = (n: number) => Array.from({ length: n }, () => ({ type: 'adult' as const }));

describe('DemoInsuranceProvider', () => {
  it('3% of the fare per passenger, flagged demo', async () => {
    const [quote] = await provider.quote({ fare: { amount: '1000.00', currency: 'USD' } }, pax(2));
    expect(quote).toMatchObject({
      quoteId: DEMO_QUOTE_ID,
      name: 'Travel Protection (Demo)',
      pricePerPassenger: { amount: '15.00', currency: 'USD' },
      total: { amount: '30.00', currency: 'USD' },
      demo: true,
    });
  });

  it('minimum 5.00 per passenger', async () => {
    const [quote] = await provider.quote({ fare: { amount: '100.00', currency: 'EUR' } }, pax(1));
    expect(quote.pricePerPassenger).toEqual({ amount: '5.00', currency: 'EUR' });
  });

  it('rounds half-up in minor units, in the currency precision', async () => {
    // 3% of 1234.50 / 3 = 12.345 → 12.35
    const [usd] = await provider.quote({ fare: { amount: '1234.50', currency: 'USD' } }, pax(3));
    expect(usd.pricePerPassenger.amount).toBe('12.35');
    expect(usd.total.amount).toBe('37.05');
    const [jpy] = await provider.quote({ fare: { amount: '123457', currency: 'JPY' } }, pax(1));
    expect(jpy.pricePerPassenger.amount).toBe('3704');
    const [kwd] = await provider.quote({ fare: { amount: '400.000', currency: 'KWD' } }, pax(1));
    expect(kwd.pricePerPassenger.amount).toBe('12.000');
  });

  it('bind returns a deterministic DEMO- policy number; unknown quotes are rejected', async () => {
    expect(await provider.bind(DEMO_QUOTE_ID, { reference: 'K7MX2QPA' })).toEqual({ policyNumber: 'DEMO-K7MX2QPA' });
    await expect(provider.bind('other', { reference: 'K7MX2QPA' })).rejects.toThrow();
  });
});
