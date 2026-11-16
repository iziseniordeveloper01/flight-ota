import { describe, expect, it } from 'vitest';
import { offerFingerprint } from './fingerprint.js';
import { MockSupplier } from './mock/mock.supplier.js';
import type { FlightOffer, SearchRequest } from './types.js';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const req: SearchRequest = {
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2026-12-20',
  returnDate: '2026-12-27',
  adults: 2,
  children: 1,
  infants: 0,
  cabin: 'economy',
};

describe('offerFingerprint', () => {
  it('same flight from two searches → same key (ids, refs, prices and expiry ignored)', async () => {
    const [a] = await new MockSupplier({ now: () => NOW }).search(req);
    const [b] = await new MockSupplier({ now: () => NOW + 60_000 }).search(req);
    expect(a.supplierOfferId).not.toBe(b.supplierOfferId); // two offer requests
    const other: FlightOffer = {
      ...b,
      id: 'duffel:off_other',
      price: { total: { amount: '1.00', currency: 'EUR' } },
      passengers: b.passengers.map((p, i) => ({ ...p, ref: `pas_${i}` })),
      slices: b.slices.map((s) => ({ ...s, segments: s.segments.map((seg, i) => ({ ...seg, ref: `seg_${i}` })) })),
    };
    expect(offerFingerprint(other)).toBe(offerFingerprint(a));
  });

  it('readable: every segment, fare brand and passenger counts', async () => {
    const [offer] = await new MockSupplier({ now: () => NOW }).search({ ...req, returnDate: undefined });
    const seg = offer.slices[0].segments[0];
    expect(offerFingerprint(offer)).toBe(
      `${seg.marketingCarrier.code}${seg.flightNumber}:LHR-JFK@${seg.departureAt}/economy|brand:${offer.fareBrand}|pax:a2c1i0`,
    );
  });

  it('different fare brand, flight, departure time, cabin or passenger mix → different key', async () => {
    const [offer] = await new MockSupplier({ now: () => NOW }).search(req);
    const key = offerFingerprint(offer);
    const editSegment = (patch: Partial<FlightOffer['slices'][number]['segments'][number]>): FlightOffer => ({
      ...offer,
      slices: offer.slices.map((s, si) => ({
        ...s,
        segments: s.segments.map((seg, i) => (si === 1 && i === 0 ? { ...seg, ...patch } : seg)),
      })),
    });
    const variants: FlightOffer[] = [
      { ...offer, fareBrand: 'Flex Plus' },
      { ...offer, fareBrand: undefined },
      editSegment({ flightNumber: '999' }),
      editSegment({ marketingCarrier: { code: 'XX', name: 'Other' } }),
      editSegment({ departureAt: '2026-12-27T23:55:00' }),
      editSegment({ cabin: 'business' }),
      { ...offer, passengers: [...offer.passengers, { ref: 'p9', type: 'infant' }] },
    ];
    for (const v of variants) expect(offerFingerprint(v)).not.toBe(key);
  });

  it('every offer of one mock search has its own key', async () => {
    const offers = await new MockSupplier({ now: () => NOW }).search(req);
    expect(new Set(offers.map(offerFingerprint)).size).toBe(offers.length);
  });
});
