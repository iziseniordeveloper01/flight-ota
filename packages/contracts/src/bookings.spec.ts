import { describe, expect, it } from 'vitest';
import {
  ageOnDate,
  contactSchema,
  idempotencyKeySchema,
  passengerDetailsSchema,
  passengerTypeForAge,
  updateBookingDetailsSchema,
} from './bookings.js';

const adult = {
  ref: 'p1',
  type: 'adult',
  title: 'mr',
  gender: 'm',
  givenName: 'John',
  familyName: 'Smith',
  dateOfBirth: '1990-05-01',
  nationality: 'gb',
} as const;
const contact = { title: 'mr', givenName: 'John', familyName: 'Smith', email: ' John@Example.COM ', phone: '+44 20 8016 0509' } as const;

const paths = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
  result.error?.issues.map((i) => i.path.join('.')) ?? [];

describe('ageOnDate / passengerTypeForAge', () => {
  it('a birthday on the travel date counts', () => {
    expect(ageOnDate('2014-07-10', '2026-07-09')).toBe(11);
    expect(ageOnDate('2014-07-10', '2026-07-10')).toBe(12);
    expect(passengerTypeForAge(ageOnDate('2014-07-10', '2026-07-10'))).toBe('adult');
    expect(passengerTypeForAge(ageOnDate('2024-07-10', '2026-07-09'))).toBe('infant');
    expect(passengerTypeForAge(ageOnDate('2024-07-10', '2026-07-10'))).toBe('child');
  });

  it('29 Feb birthdays: 28 Feb is still before, 1 Mar is the birthday in non-leap years', () => {
    expect(ageOnDate('2024-02-29', '2026-02-28')).toBe(1);
    expect(ageOnDate('2024-02-29', '2026-03-01')).toBe(2);
    expect(ageOnDate('2024-02-29', '2028-02-29')).toBe(4);
  });

  it('category boundaries: <2 infant, 2–11 child, ≥12 adult', () => {
    expect([0, 1, 2, 11, 12, 80].map(passengerTypeForAge)).toEqual(['infant', 'infant', 'child', 'child', 'adult', 'adult']);
  });
});

describe('passengerDetailsSchema', () => {
  it('normalizes names, country and passport number', () => {
    const p = passengerDetailsSchema.parse({
      ...adult,
      givenName: '  Mary   Ann ',
      familyName: "O'Brien-Smith",
      document: { type: 'passport', number: 'ab 123-456', issuingCountry: 'ie', expiryDate: '2030-01-01' },
    });
    expect(p).toMatchObject({ givenName: 'Mary Ann', familyName: "O'Brien-Smith", nationality: 'GB', noFamilyName: false });
    expect(p.document).toEqual({ type: 'passport', number: 'AB123456', issuingCountry: 'IE', expiryDate: '2030-01-01' });
  });

  it.each([
    ['accented letters', { givenName: 'José' }, 'givenName'],
    ['digits in a name', { familyName: 'Smith2' }, 'familyName'],
    ['name over 50 chars', { givenName: 'A'.repeat(51) }, 'givenName'],
    ['empty given name', { givenName: '  ' }, 'givenName'],
    ['missing family name without the flag', { familyName: null }, 'familyName'],
    ['family name with the flag', { noFamilyName: true }, 'familyName'],
    ['future date of birth', { dateOfBirth: '2999-01-01' }, 'dateOfBirth'],
    ['adult linked to an adult', { associatedAdultRef: 'p2' }, 'associatedAdultRef'],
    ['passport too short', { document: { type: 'passport', number: 'AB12', issuingCountry: 'GB', expiryDate: '2030-01-01' } }, 'document.number'],
  ])('%s → issue at %s', (_name, patch, path) => {
    expect(paths(passengerDetailsSchema.safeParse({ ...adult, ...patch }))).toContain(path);
  });

  it('a mononym with the flag is valid; an infant needs an adult', () => {
    expect(passengerDetailsSchema.safeParse({ ...adult, familyName: undefined, noFamilyName: true }).success).toBe(true);
    expect(paths(passengerDetailsSchema.safeParse({ ...adult, type: 'infant' }))).toContain('associatedAdultRef');
  });
});

describe('contactSchema', () => {
  it('lower-cases email and strips phone formatting to E.164', () => {
    expect(contactSchema.parse(contact)).toMatchObject({ email: 'john@example.com', phone: '+442080160509' });
  });

  it.each([['not-an-email', 'email'], ['020 8016 0509', 'phone'], ['+0123456789', 'phone']])('%s rejected', (value, field) => {
    expect(paths(contactSchema.safeParse({ ...contact, [field]: value }))).toContain(field);
  });
});

describe('updateBookingDetailsSchema', () => {
  const infant = { ...adult, ref: 'p3', type: 'infant', givenName: 'Baby', dateOfBirth: '2026-01-01', associatedAdultRef: 'p1' } as const;

  it('defaults services to [] and insurance to null', () => {
    expect(updateBookingDetailsSchema.parse({ passengers: [adult], contact })).toMatchObject({ services: [], insurance: null });
  });

  it('each infant needs a distinct adult on the booking', () => {
    const twoInfants = { passengers: [adult, infant, { ...infant, ref: 'p4' }], contact };
    expect(paths(updateBookingDetailsSchema.safeParse(twoInfants))).toContain('passengers.2.associatedAdultRef');
    const orphan = { passengers: [adult, { ...infant, associatedAdultRef: 'p9' }], contact };
    expect(paths(updateBookingDetailsSchema.safeParse(orphan))).toContain('passengers.1.associatedAdultRef');
  });

  it('rejects duplicate refs and services, and amounts are not accepted from the client', () => {
    const body = {
      passengers: [adult, adult],
      contact,
      services: [{ serviceId: 's1', quantity: 1 }, { serviceId: 's1', quantity: 1 }],
    };
    expect(paths(updateBookingDetailsSchema.safeParse(body))).toEqual(
      expect.arrayContaining(['passengers.1.ref', 'services.1.serviceId']),
    );
    const parsed = updateBookingDetailsSchema.parse({
      passengers: [adult],
      contact,
      services: [{ serviceId: 's1', quantity: 1, amount: '0.01' }],
    });
    expect(parsed.services[0]).not.toHaveProperty('amount');
  });
});

describe('idempotencyKeySchema', () => {
  it('accepts UUIDs and rejects short or odd keys', () => {
    expect(idempotencyKeySchema.safeParse('3f1c2a9e-7b1d-4c8e-9a51-1f0f6f9b2c11').success).toBe(true);
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('has space 12345').success).toBe(false);
  });
});
