import { searchDateBounds } from '@ota/contracts';
import { searchUrl, validateSearch, type SearchState } from './search-params';

const { first } = searchDateBounds();
const state: SearchState = {
  from: 'DEL',
  to: 'BOM',
  depart: first,
  return: null,
  adults: 1,
  children: 0,
  infants: 0,
  cabin: 'economy',
};

describe('searchUrl', () => {
  it('writes every search param explicitly, even at defaults', () => {
    expect(searchUrl(state)).toBe(
      `/flights/search?from=DEL&to=BOM&depart=${first}&adults=1&children=0&infants=0&cabin=economy`,
    );
  });
  it('adds return for round trips', () => {
    expect(searchUrl({ ...state, return: first })).toContain(`&return=${first}&`);
  });
});

describe('validateSearch', () => {
  it('returns the parsed body for valid input', () => {
    const r = validateSearch({ ...state, from: 'del' });
    expect(r.ok && r.body.origin).toBe('DEL');
  });
  it('maps schema issues to widget fields', () => {
    const r = validateSearch({ ...state, to: 'DEL', depart: '2000-01-01', infants: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(['depart', 'pax', 'to']);
    }
  });
  it('rejects missing params', () => {
    const r = validateSearch({ ...state, from: null, depart: null });
    expect(r.ok).toBe(false);
  });
});
