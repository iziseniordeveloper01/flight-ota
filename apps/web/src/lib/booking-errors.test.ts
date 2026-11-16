import type { BookingErrorBody, UpdateBookingDetailsInput } from '@ota/contracts';
import { ApiError } from './api';
import { mapBookingError } from './booking-errors';

const body = {
  passengers: [],
  contact: {},
  services: [
    { serviceId: 'bag-1', quantity: 1 },
    { serviceId: 'seat-9', quantity: 1 },
  ],
  insurance: { quoteId: 'demo-travel-protection' },
} as unknown as UpdateBookingDetailsInput;

const err = (status: number, kind: ApiError['kind'], b: Partial<BookingErrorBody>) =>
  new ApiError(kind, status, b.message ?? 'msg', b.issues ?? [], { statusCode: status, message: 'msg', ...b } as BookingErrorBody);

describe('mapBookingError', () => {
  it('rule issues land on the same form paths; a missing passport on its number field', () => {
    const r = mapBookingError(
      err(422, 'rejected', {
        code: 'AGE_CATEGORY_MISMATCH',
        issues: [
          { code: 'AGE_CATEGORY_MISMATCH', path: 'passengers.1.dateOfBirth', message: 'too old' },
          { code: 'NAME_TOO_LONG', path: 'passengers.0.givenName', message: 'too long' },
          { code: 'DOCUMENT_REQUIRED', path: 'passengers.0.document', message: 'passport' },
          { code: 'DOCUMENT_EXPIRED', path: 'passengers.0.document.expiryDate', message: 'expired' },
        ],
      }),
      body,
    );
    expect(r.fields.map((f) => f.path)).toEqual([
      'passengers.1.dateOfBirth',
      'passengers.0.givenName',
      'passengers.0.document.number',
      'passengers.0.document.expiryDate',
    ]);
    expect(r.banner).toBe('Please check the highlighted fields.');
  });

  it('service issues point at the selected service; insurance at the insurance card', () => {
    const r = mapBookingError(
      err(422, 'rejected', {
        code: 'INVALID_SERVICE',
        issues: [
          { code: 'INVALID_SERVICE', path: 'services.1.serviceId', message: 'gone' },
          { code: 'INSURANCE_QUOTE_INVALID', path: 'insurance.quoteId', message: 'gone' },
        ],
      }),
      body,
    );
    expect(r).toMatchObject({ serviceIds: ['seat-9'], insurance: true, fields: [] });
  });

  it('400 schema issues (no business code) map the same way', () => {
    const r = mapBookingError(new ApiError('validation', 400, 'x', [{ path: 'contact.email', message: 'Enter a valid email address' }]), body);
    expect(r.fields).toEqual([{ path: 'contact.email', message: 'Enter a valid email address' }]);
  });

  it('SERVICE_UNAVAILABLE splits bags/seats from insurance', () => {
    const r = mapBookingError(err(422, 'rejected', { code: 'SERVICE_UNAVAILABLE', serviceIds: ['bag-1', 'demo-travel-protection'] }), body);
    expect(r).toMatchObject({ serviceIds: ['bag-1'], insurance: true });
  });

  it('PRICE_CHANGED carries both totals; 410 means expired', () => {
    const previousTotal = { amount: '100.00', currency: 'USD' };
    const newTotal = { amount: '112.00', currency: 'USD' };
    expect(mapBookingError(err(422, 'rejected', { code: 'PRICE_CHANGED', previousTotal, newTotal }), body).priceChange).toEqual({
      previous: previousTotal,
      next: newTotal,
    });
    expect(mapBookingError(err(410, 'expired', { code: 'BOOKING_EXPIRED' }), body).expired).toBe(true);
  });

  it('a passenger-mix problem or unknown failure becomes the banner', () => {
    const mismatch = mapBookingError(
      err(422, 'rejected', { code: 'PASSENGERS_MISMATCH', issues: [{ code: 'PASSENGERS_MISMATCH', path: 'passengers', message: 'search again' }] }),
      body,
    );
    expect(mismatch.banner).toBe('search again');
    expect(mapBookingError(new Error('boom'), body).banner).toMatch(/went wrong/);
  });
});
