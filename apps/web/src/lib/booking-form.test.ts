import { ageCategoryError, bookingFormSchema, emptyPassport, titlesFor, type BookingFormValues, type FormContext } from './booking-form';

const ctx: FormContext = { lastFlightDate: '2026-12-20', documentRequired: false, maxNameLength: null };

const values = (patch: Partial<BookingFormValues['passengers'][number]> = {}): BookingFormValues => ({
  passengers: [
    {
      ref: 'p1',
      type: 'adult',
      title: 'mr',
      gender: 'm',
      givenName: 'Arjun',
      familyName: 'Mehta',
      noFamilyName: false,
      dateOfBirth: '1990-05-01',
      nationality: 'IN',
      document: null,
      associatedAdultRef: null,
      ...patch,
    },
  ],
  contact: { title: 'mr', givenName: 'Arjun', familyName: 'Mehta', email: 'arjun@example.com', phone: '+919876543210' },
});

const issues = (v: BookingFormValues, c: FormContext = ctx) => {
  const r = bookingFormSchema(c).safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
};

describe('bookingFormSchema', () => {
  it('a complete adult is valid and normalised for the API', () => {
    const r = bookingFormSchema(ctx).safeParse(values({ givenName: '  Arjun  ' }));
    expect(r.success).toBe(true);
    expect(r.data?.passengers[0]).toMatchObject({ givenName: 'Arjun', familyName: 'Mehta', associatedAdultRef: null });
    expect(r.data?.services).toEqual([]);
  });

  it('age category: a date of birth that makes the adult a child → inline error on dateOfBirth', () => {
    const [issue] = issues(values({ dateOfBirth: '2016-01-01' }));
    expect(issue.path).toBe('passengers.0.dateOfBirth');
    expect(issue.message).toBe(
      'This date of birth makes this passenger 10 on the day of travel — a child, not an adult. Please search again with the right passengers.',
    );
    // Turning 12 ON the last flight date makes them an adult.
    expect(issues(values({ dateOfBirth: '2014-12-20' }))).toEqual([]);
    expect(ageCategoryError('2014-12-21', 'adult', '2026-12-20')).toEqual({ age: 11, actual: 'child' });
    expect(ageCategoryError('', 'adult', '2026-12-20')).toBeNull();
  });

  it('mononym: empty family name is fine with the checkbox, required without it', () => {
    expect(issues(values({ familyName: '', noFamilyName: true }))).toEqual([]);
    expect(issues(values({ familyName: '' })).map((i) => i.path)).toEqual(['passengers.0.familyName']);
  });

  it('enforces the supplier name limit', () => {
    expect(issues(values({ givenName: 'Abcdefghijklmnopqrstu' }), { ...ctx, maxNameLength: 20 })).toEqual([
      { path: 'passengers.0.givenName', message: 'The airline accepts at most 20 characters per name.' },
    ]);
  });

  it('passport: required when the server says so; expiry after the last flight; a kept one is fine', () => {
    const required = { ...ctx, documentRequired: true };
    expect(issues(values(), required).map((i) => i.path)).toEqual(['passengers.0.document.number']);
    expect(issues(values({ document: emptyPassport() }), required).map((i) => i.path)).toEqual(
      expect.arrayContaining(['passengers.0.document.number', 'passengers.0.document.issuingCountry', 'passengers.0.document.expiryDate']),
    );
    const expired = { type: 'passport' as const, number: 'Z1234567', issuingCountry: 'IN', expiryDate: '2026-12-20' };
    expect(issues(values({ document: expired }), required).map((i) => i.path)).toEqual(['passengers.0.document.expiryDate']);
    expect(issues(values({ document: { keepExisting: true } }), required)).toEqual([]);
  });

  it('titles depend on the passenger type', () => {
    expect(titlesFor('adult')).toEqual(['mr', 'mrs', 'ms', 'miss']);
    expect(titlesFor('infant')).toEqual(['mr', 'miss']);
  });
});
