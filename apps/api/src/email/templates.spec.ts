import { formatMoney, localDateTime, renderBookingConfirmed, renderRefundCompleted, renderRefundInitiated, type EmailBookingData } from './templates.js';

const data: EmailBookingData = {
  brand: 'SkyFare',
  reference: 'K7MX2QPA',
  pnr: 'ZX4K2P',
  demo: true,
  contactName: 'Jane',
  segments: [{ flight: 'ZZ 117', from: 'LHR', to: 'JFK', departureAt: '2026-12-16T09:05:00', arrivalAt: '2026-12-16T12:10:00' }],
  passengers: ['Mrs Jane Doe', 'Mr John <script>Doe'],
  extras: ['1 × 23kg checked bag', 'Seat 14C'],
  total: { amount: '12767.60', currency: 'INR' },
};

describe('email templates', () => {
  it('booking confirmed: PNR, reference, itinerary, names, extras, INR total, demo note — in HTML and text', () => {
    const e = renderBookingConfirmed(data);
    expect(e.subject).toBe('SkyFare: your booking K7MX2QPA is confirmed');
    for (const body of [e.html, e.text]) {
      expect(body).toContain('ZX4K2P');
      expect(body).toContain('K7MX2QPA');
      expect(body).toContain('LHR 16 Dec 2026 09:05');
      expect(body).toContain('Mrs Jane Doe');
      expect(body).toContain('Seat 14C');
      expect(body).toContain('₹12,767.60');
      expect(body).toContain('TEST BOOKING');
    }
  });

  it('escapes HTML in names (no injection), inline styles only', () => {
    const { html } = renderBookingConfirmed(data);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<style/i);
  });

  it('contains no PII beyond names: no DOB, no document numbers, no phone, no email', () => {
    const all = [renderBookingConfirmed(data), renderRefundInitiated(data, { amount: data.total, reason: 'BOOKING_FAILED' }), renderRefundCompleted(data, { amount: data.total })];
    for (const e of all) {
      const text = `${e.subject}${e.html}${e.text}`;
      expect(text).not.toMatch(/passport|date of birth|\bDOB\b/i);
      expect(text).not.toMatch(/@/); // no address in the body
      expect(text).not.toMatch(/\+\d{7,}/);
    }
  });

  it('refund initiated: amount, reason-specific copy, timing; refund completed', () => {
    const failed = renderRefundInitiated(data, { amount: data.total, reason: 'BOOKING_FAILED' });
    expect(failed.text).toContain("couldn't confirm your ticket");
    expect(failed.text).toContain('5–7 working days');
    expect(failed.text).toContain('₹12,767.60');
    expect(renderRefundInitiated(data, { amount: data.total, reason: 'LATE_PAYMENT' }).text).toContain('after this fare had expired');
    expect(renderRefundCompleted(data, { amount: data.total }).subject).toBe('SkyFare: your refund for booking K7MX2QPA is complete');
  });

  it('no demo note for real bookings', () => {
    expect(renderBookingConfirmed({ ...data, demo: false }).text).not.toContain('TEST BOOKING');
  });

  it('formats local times without a timezone shift and money exactly', () => {
    expect(localDateTime('2026-01-05T23:59:00')).toBe('5 Jan 2026 23:59');
    expect(formatMoney({ amount: '0.10', currency: 'INR' })).toBe('₹0.10');
    expect(formatMoney({ amount: '100000.00', currency: 'INR' })).toBe('₹1,00,000.00');
  });
});
