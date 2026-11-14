import { describe, expect, it } from 'vitest';
import { SupplierError } from '../errors.js';
import { compareMoney, sumMoney, toMinor } from '../money.js';
import type { CreateOrderInput, FlightOffer, OrderLookup, SearchRequest } from '../types.js';
import { MockSupplier } from './mock.supplier.js';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const base: SearchRequest = {
  origin: 'DEL',
  destination: 'BOM',
  departureDate: '2026-12-20',
  adults: 2,
  children: 1,
  infants: 1,
  cabin: 'economy',
};

function allMoney(offer: FlightOffer) {
  const { total, base: b, taxes, perPassenger = [] } = offer.price;
  return [total, b, taxes, ...perPassenger.map((p) => p.total)].filter((m) => m !== undefined);
}

async function codeOf(promise: Promise<unknown>) {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(SupplierError);
  return (err as SupplierError).code;
}

describe('MockSupplier', () => {
  it('is deterministic: same request → identical offers', async () => {
    const a = await new MockSupplier({ now: () => NOW }).search(base);
    const b = await new MockSupplier({ now: () => NOW }).search({ ...base });
    expect(a).toEqual(b);
    const other = await new MockSupplier({ now: () => NOW }).search({ ...base, departureDate: '2026-12-21' });
    expect(other.map((o) => o.price.total)).not.toEqual(a.map((o) => o.price.total));
  });

  it('returns ~10 offers mixing direct and 1-stop across 3 carriers', async () => {
    const offers = await new MockSupplier({ now: () => NOW }).search(base);
    expect(offers).toHaveLength(10);
    expect(new Set(offers.map((o) => o.slices[0].stops))).toEqual(new Set([0, 1]));
    expect(new Set(offers.map((o) => o.owner.code))).toEqual(new Set(['M1', 'M2', 'M3']));
    for (const o of offers) {
      expect(o.id).toBe(`mock:${o.supplierOfferId}`);
      expect(o.expiresAt).toBe(new Date(NOW + 20 * 60_000).toISOString());
      const [slice] = o.slices;
      expect(slice.segments).toHaveLength(slice.stops + 1);
      expect(slice.durationMinutes).toBeGreaterThanOrEqual(
        slice.segments.reduce((s, seg) => s + seg.durationMinutes, 0),
      );
      expect(slice.departureAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    }
  });

  it('round trip → 2 slices, the second reversed', async () => {
    const offers = await new MockSupplier().search({ ...base, returnDate: '2026-12-27' });
    for (const o of offers) {
      expect(o.slices).toHaveLength(2);
      expect(o.slices[1].origin).toBe('BOM');
      expect(o.slices[1].destination).toBe('DEL');
      expect(o.slices[1].departureAt.startsWith('2026-12-27')).toBe(true);
    }
  });

  it('money is always a clean decimal string in the request currency', async () => {
    const supplier = new MockSupplier();
    for (const [currency, pattern] of [
      ['USD', /^\d+\.\d{2}$/],
      ['JPY', /^\d+$/],
      ['KWD', /^\d+\.\d{3}$/],
    ] as const) {
      const offers = await supplier.search({ ...base, currency, cabin: 'business', returnDate: '2026-12-28' });
      for (const m of offers.flatMap(allMoney)) {
        expect(m.currency).toBe(currency);
        expect(m.amount).toMatch(pattern);
      }
    }
  });

  it('defaults to USD and perPassenger/base+taxes add up to the total exactly', async () => {
    const offers = await new MockSupplier().search(base);
    for (const { price } of offers) {
      expect(price.total.currency).toBe('USD');
      const sum = (xs: string[]) => xs.reduce((s, x) => s + toMinor(x, 2), 0n);
      expect(sum(price.perPassenger!.map((p) => p.total.amount))).toBe(toMinor(price.total.amount, 2));
      expect(sum([price.base!.amount, price.taxes!.amount])).toBe(toMinor(price.total.amount, 2));
      expect(price.perPassenger!.map((p) => [p.type, p.count])).toEqual([
        ['adult', 2],
        ['child', 1],
        ['infant', 1],
      ]);
    }
  });

  it('PVD→RAI returns no offers', async () => {
    expect(await new MockSupplier().search({ ...base, origin: 'PVD', destination: 'RAI' })).toEqual([]);
  });

  it('STN→LHR throws TIMEOUT', async () => {
    expect(await codeOf(new MockSupplier().search({ ...base, origin: 'STN', destination: 'LHR' }))).toBe(
      'TIMEOUT',
    );
  });

  it('an already-aborted signal → TIMEOUT', async () => {
    expect(await codeOf(new MockSupplier().search(base, { signal: AbortSignal.abort() }))).toBe('TIMEOUT');
  });

  it('price() keeps the price for normal routes', async () => {
    const supplier = new MockSupplier();
    const [offer] = await supplier.search(base);
    const priced = await supplier.price(offer.supplierOfferId, { previousTotal: offer.price.total });
    expect(priced.priceChanged).toBe(false);
    expect(priced.price.total).toEqual(offer.price.total);
  });

  it('price() for LHR→STN offers reports a higher total', async () => {
    const supplier = new MockSupplier();
    const [offer] = await supplier.search({ ...base, origin: 'LHR', destination: 'STN' });
    const priced = await supplier.price(offer.supplierOfferId);
    expect(priced.priceChanged).toBe(true);
    expect(priced.previousTotal).toEqual(offer.price.total);
    expect(toMinor(priced.price.total.amount, 2)).toBeGreaterThan(toMinor(offer.price.total.amount, 2));
  });

  it('price() works on a fresh MockSupplier instance (simulated API restart)', async () => {
    const req: SearchRequest = { ...base, returnDate: '2026-12-27', cabin: 'premium_economy', currency: 'EUR' };
    const offers = await new MockSupplier({ now: () => NOW }).search(req);
    const later = new MockSupplier({ now: () => NOW + 5 * 60_000 });
    for (const offer of offers) {
      expect(offer.supplierOfferId).toMatch(/^[A-Za-z0-9_-]+$/);
      const priced = await later.price(offer.supplierOfferId, { previousTotal: offer.price.total });
      const { expiresAt: _a, ...expected } = offer;
      const { expiresAt: _b, priceChanged, ...actual } = priced;
      expect(priceChanged).toBe(false);
      expect(actual).toEqual(expected);
    }
    // LHR→STN keeps its price-change scenario after a restart too.
    const [lhr] = await new MockSupplier({ now: () => NOW }).search({ ...base, origin: 'LHR', destination: 'STN' });
    const repriced = await later.price(lhr.supplierOfferId, { previousTotal: lhr.price.total });
    expect(repriced.priceChanged).toBe(true);
  });

  it('price() for an undecodable or invalid id → OFFER_NOT_FOUND', async () => {
    const supplier = new MockSupplier({ now: () => NOW });
    const [offer] = await supplier.search(base);
    const key = JSON.parse(Buffer.from(offer.supplierOfferId, 'base64url').toString());
    const forged = (patch: object) => Buffer.from(JSON.stringify({ ...key, ...patch })).toString('base64url');
    for (const id of [
      'mk_nope_0',
      Buffer.from('not json').toString('base64url'),
      Buffer.from('null').toString('base64url'),
      forged({ idx: 10 }),
      forged({ cab: 'toString' }),
      forged({ dep: '2026-02-30' }),
      forged({ i: 3 }), // more infants than adults
      forged({ o: 'del' }),
    ]) {
      expect(await codeOf(supplier.price(id))).toBe('OFFER_NOT_FOUND');
    }
  });

  it('price() once the departure date has passed → OFFER_EXPIRED', async () => {
    let now = NOW;
    const supplier = new MockSupplier({ now: () => now });
    const [offer] = await supplier.search(base); // departs 2026-12-20
    now = Date.parse('2026-12-20T23:59:59Z');
    await expect(supplier.price(offer.supplierOfferId)).resolves.toBeDefined();
    now = Date.parse('2026-12-21T00:00:00Z');
    expect(await codeOf(supplier.price(offer.supplierOfferId))).toBe('OFFER_EXPIRED');
  });
});

describe('MockSupplier booking', () => {
  const supplier = new MockSupplier({ now: () => NOW });
  const roundTrip = { ...base, returnDate: '2026-12-27' }; // 2 adults, 1 child, 1 infant

  async function firstOffer(req: SearchRequest = roundTrip) {
    return (await supplier.search(req))[0];
  }

  function orderInput(offer: FlightOffer, services: CreateOrderInput['services'], familyName = 'Doe'): CreateOrderInput {
    return {
      supplierOfferId: offer.supplierOfferId,
      supplierRef: offer.supplierRef,
      passengers: offer.passengers.map((p, i) => ({
        ref: p.ref, type: p.type, title: 'mr', gender: 'm', givenName: 'Jo', familyName: i === 0 ? familyName : 'Doe',
        dateOfBirth: '1990-01-01', nationality: 'GB',
        ...(p.type === 'infant' ? { associatedAdultRef: 'p1' } : {}),
      })),
      contact: { email: 'a@example.com', phone: '+441234567890' },
      services,
      expectedTotal: offer.price.total,
      idempotencyKey: 'booking-1',
    };
  }

  it('offers carry passenger slots and segment refs in search order', async () => {
    const offer = await firstOffer();
    expect(offer.passengers).toEqual([
      { ref: 'p1', type: 'adult' }, { ref: 'p2', type: 'adult' }, { ref: 'p3', type: 'child' }, { ref: 'p4', type: 'infant' },
    ]);
    expect(offer.slices[0].segments[0].ref).toBe('s0-0');
    expect(offer.slices[1].segments[0].ref).toBe('s1-0');
  });

  it('bags: 15kg + 23kg per seated passenger per slice, none for infants', async () => {
    const offer = await firstOffer();
    const { bags, seatsAvailable, passengerRequirements } = await supplier.getAncillaries(offer.supplierOfferId);
    expect(bags).toHaveLength(3 * 2 * 2);
    expect(bags.some((b) => b.passengerRef === 'p4')).toBe(false);
    expect(bags[0]).toMatchObject({ label: '15kg checked bag', weightKg: 15, maxQuantity: 2, price: { amount: '20.00', currency: 'USD' } });
    expect(bags[0].segmentRefs).toEqual(offer.slices[0].segments.map((s) => s.ref));
    expect(seatsAvailable).toBe(true);
    expect(passengerRequirements).toEqual({ identityDocumentRequired: null, maxNameLength: null });
    expect(await supplier.getAncillaries(offer.supplierOfferId)).toEqual({ bags, seatsAvailable, passengerRequirements });
  });

  it('seat map: one per segment, rows 1–30 ABC|DEF, some taken, exit rows adults only, paid and free', async () => {
    const offer = await firstOffer();
    const maps = await supplier.getSeatMaps(offer.supplierOfferId);
    expect(maps.map((m) => m.segmentRef)).toEqual(offer.slices.flatMap((s) => s.segments.map((x) => x.ref)));
    const rows = maps[0].cabins[0].rows;
    expect(rows.filter((r) => r.number !== null).map((r) => r.number)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    const seats = rows.flatMap((r) => r.sections.flatMap((s) => s.elements)).filter((e) => e.type === 'seat');
    expect(seats).toHaveLength(180);
    expect(seats.some((s) => !s.available)).toBe(true);
    const exit = seats.find((s) => s.designator.startsWith('12') && s.available)!;
    expect(exit.services.map((s) => s.passengerRef)).toEqual(['p1', 'p2']);
    expect(seats.find((s) => s.designator.startsWith('1') && s.designator.length === 2 && s.available)!.services[0].price.amount).toBe('25.00');
    expect(seats.find((s) => s.designator.startsWith('20') && s.available)!.services[0].price.amount).toBe('0.00');
    expect(rows.some((r) => r.sections.some((s) => s.elements[0].type === 'exit'))).toBe(true);
  });

  it('createOrder: total = fare + services; deterministic PNR; retrieveOrder by id', async () => {
    const offer = await firstOffer();
    const { bags } = await supplier.getAncillaries(offer.supplierOfferId);
    const input = orderInput(offer, [{ serviceId: bags[1].serviceId, quantity: 2 }]);
    input.expectedTotal = sumMoney([offer.price.total, { amount: '70.00', currency: 'USD' }], 'USD');
    const result = await supplier.createOrder(input);
    expect(result.status).toBe('confirmed');
    expect(result.pnr).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(result.total).toEqual(input.expectedTotal);
    expect(await supplier.createOrder(input)).toEqual(result);
    expect(await supplier.retrieveOrder({ ...lookupOf(input), supplierOrderId: result.supplierOrderId })).toEqual(result);
    expect(await supplier.retrieveOrder(lookupOf(input))).toBeNull(); // no timeout happened
  });

  it('createOrder: expected total off → PRICE_CHANGED with newTotal; unknown service → INVALID_REQUEST', async () => {
    const offer = await firstOffer();
    const wrong = { ...orderInput(offer, []), expectedTotal: { amount: '1.00', currency: 'USD' } };
    const err = await supplier.createOrder(wrong).catch((e: SupplierError) => e);
    expect(err).toMatchObject({ code: 'PRICE_CHANGED', newTotal: offer.price.total });
    expect(await codeOf(supplier.createOrder(orderInput(offer, [{ serviceId: 'bag:nope', quantity: 1 }])))).toBe('INVALID_REQUEST');
    const tooMany = orderInput(offer, [{ serviceId: (await supplier.getAncillaries(offer.supplierOfferId)).bags[0].serviceId, quantity: 3 }]);
    expect(await codeOf(supplier.createOrder(tooMany))).toBe('INVALID_REQUEST');
  });

  it('family-name scenarios: FAIL, PRICECHANGE, TIMEOUT (order recoverable by lookup)', async () => {
    const offer = await firstOffer();
    expect(await codeOf(supplier.createOrder(orderInput(offer, [], 'fail')))).toBe('UPSTREAM_ERROR');
    const changed = await supplier.createOrder(orderInput(offer, [], 'PriceChange')).catch((e: SupplierError) => e);
    expect(changed).toMatchObject({ code: 'PRICE_CHANGED' });
    expect(compareMoney((changed as SupplierError).newTotal!, offer.price.total)).toBe(1);

    const slow = orderInput(offer, [], 'TIMEOUT');
    expect(await codeOf(supplier.createOrder(slow))).toBe('TIMEOUT');
    const found = await supplier.retrieveOrder(lookupOf(slow));
    expect(found).toMatchObject({ status: 'confirmed', total: slow.expectedTotal });
  });

  it('LGW→LHR late booking: within 14 days the fare rises 10% and the 23kg bag sells out', async () => {
    let now = NOW;
    const clocked = new MockSupplier({ now: () => now });
    const [offer] = await clocked.search({ ...base, origin: 'LGW', destination: 'LHR' }); // departs 2026-12-20
    const early = await clocked.getAncillaries(offer.supplierOfferId);
    expect((await clocked.price(offer.supplierOfferId)).priceChanged).toBe(false);
    now = Date.parse('2026-12-06T12:00:00Z');
    const late = await clocked.price(offer.supplierOfferId);
    expect(late.priceChanged).toBe(true);
    expect(compareMoney(late.price.total, offer.price.total)).toBe(1);
    const lateBags = (await clocked.getAncillaries(offer.supplierOfferId)).bags;
    expect(lateBags.some((b) => b.weightKg === 23)).toBe(false);
    expect(lateBags.length).toBe(early.bags.length / 2);
  });
});

function lookupOf(input: CreateOrderInput): OrderLookup {
  const lead = input.passengers[0];
  return {
    idempotencyKey: input.idempotencyKey,
    leadPassenger: { givenName: lead.givenName, familyName: lead.familyName },
    expectedTotal: input.expectedTotal,
  };
}
