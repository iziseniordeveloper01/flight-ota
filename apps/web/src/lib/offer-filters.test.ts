import { offer } from '@/test/fixtures';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  filterFacets,
  stopBucket,
  timeBucket,
  type OfferFilters,
} from './offer-filters';

const direct = offer({ amount: '120.00', owner: 'AA', refundable: true, slices: [{ depart: '2026-12-15T05:59:00' }] });
const oneStop = offer({ amount: '90.00', owner: 'BB', refundable: false, slices: [{ depart: '2026-12-15T06:00:00', via: ['DXB'] }] });
const twoStops = offer({ amount: '75.50', owner: 'AA', slices: [{ depart: '2026-12-15T18:00:00', via: ['DXB', 'IST'] }] });
// Round trip: direct outbound in the afternoon, 1-stop return → counts as 1 stop.
const roundTrip = offer({
  amount: '300.00',
  owner: 'CC',
  refundable: true,
  slices: [
    { depart: '2026-12-15T12:00:00' },
    { from: 'BOM', to: 'DEL', depart: '2026-12-20T07:00:00', via: ['HYD'] },
  ],
});
const all = [direct, oneStop, twoStops, roundTrip];

const f = (patch: Partial<OfferFilters>) => ({ ...EMPTY_FILTERS, ...patch });

describe('buckets', () => {
  it('stops: most stops on any slice, 2+ grouped', () => {
    expect([direct, oneStop, twoStops, roundTrip].map(stopBucket)).toEqual([0, 1, 2, 1]);
  });
  it('time buckets on airport-local hour boundaries', () => {
    expect(timeBucket('2026-12-15T00:00:00')).toBe('night');
    expect(timeBucket('2026-12-15T05:59:00')).toBe('night');
    expect(timeBucket('2026-12-15T06:00:00')).toBe('morning');
    expect(timeBucket('2026-12-15T12:00:00')).toBe('afternoon');
    expect(timeBucket('2026-12-15T17:59:00')).toBe('afternoon');
    expect(timeBucket('2026-12-15T18:00:00')).toBe('evening');
    expect(timeBucket('2026-12-15T23:59:00')).toBe('evening');
  });
});

describe('applyFilters', () => {
  it('no filters → everything', () => {
    expect(applyFilters(all, EMPTY_FILTERS)).toEqual(all);
  });
  it('stops (Direct means every slice direct)', () => {
    expect(applyFilters(all, f({ stops: [0] }))).toEqual([direct]);
    expect(applyFilters(all, f({ stops: [1, 2] }))).toEqual([oneStop, twoStops, roundTrip]);
  });
  it('airlines', () => {
    expect(applyFilters(all, f({ airlines: ['AA'] }))).toEqual([direct, twoStops]);
  });
  it('departure time uses the outbound slice', () => {
    expect(applyFilters(all, f({ times: ['afternoon'] }))).toEqual([roundTrip]);
    expect(applyFilters(all, f({ times: ['night', 'evening'] }))).toEqual([direct, twoStops]);
  });
  it('price range in minor units, inclusive', () => {
    expect(applyFilters(all, f({ priceMin: 9000n, priceMax: 12000n }))).toEqual([direct, oneStop]);
    expect(applyFilters(all, f({ priceMax: 7550n }))).toEqual([twoStops]);
  });
  it('refundable only excludes unknown (null)', () => {
    expect(applyFilters(all, f({ refundableOnly: true }))).toEqual([direct, roundTrip]);
  });
  it('combines groups with AND', () => {
    expect(applyFilters(all, f({ airlines: ['AA'], stops: [0] }))).toEqual([direct]);
  });
  it('ignores the price range when currencies are mixed', () => {
    const eur = offer({ amount: '50.00', currency: 'EUR' });
    expect(applyFilters([direct, eur], f({ priceMax: 1n }))).toEqual([direct, eur]);
  });
});

describe('facets', () => {
  it('counts per option and min price per airline', () => {
    const facets = filterFacets(all);
    expect(facets.stops).toEqual({ 0: 1, 1: 2, 2: 1 });
    expect(facets.times).toEqual({ night: 1, morning: 1, afternoon: 1, evening: 1 });
    const aa = facets.airlines.find((a) => a.code === 'AA');
    // Facets use the display price (INR — the only currency the web shows).
    expect(aa).toMatchObject({ count: 2, minPrice: { amount: '75.50', currency: 'INR' } });
    expect(facets.price).toEqual({ min: 7550n, max: 30000n, currency: 'INR' });
  });
  it('no price facet for mixed currencies', () => {
    expect(filterFacets([direct, offer({ currency: 'EUR' })]).price).toBeNull();
  });
  it('activeFilterCount counts groups', () => {
    expect(activeFilterCount(f({ stops: [0, 1], airlines: ['AA'], priceMax: 1n }))).toBe(3);
  });
});
