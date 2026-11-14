import { describe, expect, it } from 'vitest';
import { offerIdSchema, searchDateBounds, searchFlightsSchema } from './flights.js';

const { first, last } = searchDateBounds();
const valid = { origin: 'del', destination: 'BOM', departureDate: first };

function issues(input: unknown): Record<string, string> {
  const r = searchFlightsSchema.safeParse(input);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
}

describe('searchFlightsSchema', () => {
  it('uppercases IATA codes and applies defaults', () => {
    expect(searchFlightsSchema.parse(valid)).toEqual({
      origin: 'DEL',
      destination: 'BOM',
      departureDate: first,
      adults: 1,
      children: 0,
      infants: 0,
      cabin: 'economy',
    });
  });

  it('rejects same origin and destination', () => {
    expect(issues({ ...valid, destination: 'DEL' })).toHaveProperty('destination');
  });

  it('rejects past dates and dates beyond the window', () => {
    expect(issues({ ...valid, departureDate: '2000-01-01' })).toHaveProperty('departureDate');
    const tooFar = new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(issues({ ...valid, departureDate: tooFar })).toHaveProperty('departureDate');
    expect(issues({ ...valid, departureDate: last })).toEqual({});
  });

  it('requires return on or after departure', () => {
    const d = new Date(Date.parse(`${first}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
    expect(issues({ ...valid, departureDate: d, returnDate: first })).toHaveProperty('returnDate');
    expect(issues({ ...valid, departureDate: d, returnDate: d })).toEqual({});
  });

  it('enforces passenger rules', () => {
    expect(issues({ ...valid, adults: 0 })).toHaveProperty('adults');
    expect(issues({ ...valid, adults: 2, infants: 3 })).toHaveProperty('infants');
    expect(issues({ ...valid, adults: 5, children: 5 })).toHaveProperty('children');
    expect(issues({ ...valid, adults: 4, children: 5, infants: 4 })).toEqual({});
  });
});

describe('offerIdSchema', () => {
  it('accepts supplier-prefixed ids only', () => {
    expect(offerIdSchema.safeParse('mock:abc_1').success).toBe(true);
    expect(offerIdSchema.safeParse('abc').success).toBe(false);
    expect(offerIdSchema.safeParse('duffel:../x').success).toBe(false);
  });

  it('allows supplier offer ids up to 256 chars', () => {
    expect(offerIdSchema.safeParse(`mock:${'a'.repeat(256)}`).success).toBe(true);
    expect(offerIdSchema.safeParse(`mock:${'a'.repeat(257)}`).success).toBe(false);
  });
});
