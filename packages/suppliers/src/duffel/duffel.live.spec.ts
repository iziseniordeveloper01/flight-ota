import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { multiplyMoney, sumMoney } from '../money.js';
import type { FlightOffer, SeatService } from '../types.js';
import { DuffelAdapter } from './duffel.adapter.js';

// Real network calls to Duffel TEST mode. Opt-in only:
//   DUFFEL_LIVE_TEST=1 pnpm --filter "@ota/suppliers" test
const live = process.env.DUFFEL_LIVE_TEST === '1';

function adapter(): DuffelAdapter {
  // The adapter never reads env; the test loads the root .env itself (Node 24 built-in).
  if (!process.env.DUFFEL_ACCESS_TOKEN) process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
  const token = process.env.DUFFEL_ACCESS_TOKEN ?? '';
  expect(token.startsWith('duffel_test_')).toBe(true); // never hit live mode from a test
  return new DuffelAdapter({ accessToken: token });
}

const departureDate = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!live)('DuffelAdapter (live, test mode)', () => {
  it('LHR→JFK 30 days ahead returns offers', { timeout: 60_000 }, async () => {
    const offers = await adapter().search(
      { origin: 'LHR', destination: 'JFK', departureDate: departureDate(), adults: 1, children: 0, infants: 0, cabin: 'economy' },
      { timeoutMs: 45_000 },
    );
    expect(offers.length).toBeGreaterThan(0);
  });

  it('books a Duffel Airways (ZZ) flight with 1 bag + 1 seat → booking reference', { timeout: 240_000 }, async () => {
    const duffel = adapter();
    const offers = await duffel.search(
      { origin: 'LHR', destination: 'JFK', departureDate: departureDate(), adults: 1, children: 0, infants: 0, cabin: 'economy' },
      { timeoutMs: 45_000 },
    );
    const zz = offers.filter((o) => o.owner.code === 'ZZ' && o.slices.every((s) => s.stops === 0));
    expect(zz.length).toBeGreaterThan(0);

    // Not every ZZ offer has bags and seats; take the first that has both.
    let picked: { offer: FlightOffer; bag: { serviceId: string; price: FlightOffer['price']['total'] }; seat: SeatService } | undefined;
    for (const offer of zz.slice(0, 5)) {
      const [anc, maps] = await Promise.all([
        duffel.getAncillaries(offer.supplierOfferId, { timeoutMs: 30_000 }),
        duffel.getSeatMaps(offer.supplierOfferId, { timeoutMs: 30_000 }),
      ]);
      const bag = anc.bags.find((b) => b.passengerRef === offer.passengers[0].ref);
      const seat = maps
        .flatMap((m) => m.cabins.flatMap((c) => c.rows.flatMap((r) => r.sections.flatMap((s) => s.elements))))
        .flatMap((e) => (e.type === 'seat' ? e.services : []))
        .find((s) => s.passengerRef === offer.passengers[0].ref);
      if (bag && seat) {
        picked = { offer, bag, seat };
        break;
      }
    }
    expect(picked, 'a ZZ offer with bags and seats').toBeDefined();
    const { offer, bag, seat } = picked!;

    const fare = (await duffel.price(offer.supplierOfferId, { timeoutMs: 30_000 })).price.total;
    const expectedTotal = sumMoney([fare, multiplyMoney(bag.price, 1), seat.price], fare.currency);
    const idempotencyKey = `live-test-${Date.now()}`;
    const result = await duffel.createOrder(
      {
        supplierOfferId: offer.supplierOfferId,
        supplierRef: offer.supplierRef,
        passengers: [{
          ref: offer.passengers[0].ref, type: 'adult', title: 'ms', gender: 'f', givenName: 'Amelia',
          familyName: 'Earhart', dateOfBirth: '1987-07-24', nationality: 'GB',
        }],
        contact: { email: 'amelia@example.com', phone: '+442080160509' },
        services: [{ serviceId: bag.serviceId, quantity: 1 }, { serviceId: seat.serviceId, quantity: 1 }],
        expectedTotal,
        idempotencyKey,
      },
      { timeoutMs: 130_000 },
    );

    expect(result.status).toBe('confirmed');
    expect(result.pnr).toMatch(/^[A-Z0-9]{5,8}$/);
    expect(result.total).toEqual(expectedTotal);
    const again = await duffel.retrieveOrder(
      { supplierOrderId: result.supplierOrderId, idempotencyKey, leadPassenger: { givenName: 'Amelia', familyName: 'Earhart' }, expectedTotal },
      { timeoutMs: 30_000 },
    );
    expect(again?.pnr).toBe(result.pnr);
  });
});
