import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { Redis } from 'ioredis';
import type { PrismaClient } from '@ota/db';
import type { PublicFlightOffer, PublicPricedOffer } from '@ota/contracts';
import { compareMoney, MockSupplier } from '@ota/suppliers';
import { REDIS_CLIENT } from './../src/redis/redis.module.js';
import { PRISMA } from './../src/prisma/prisma.module.js';
import { createTestApp, deleteKeys, FixedRateSource } from './test-app.js';

// Always the offline mock (USD unless a currency is requested) and fixed FX rates. Requires Redis + Postgres.
describe('Flights (e2e)', () => {
  let app: INestApplication<App>;
  let redis: Redis;
  let prisma: PrismaClient;
  const fx = new FixedRateSource('test-fixed-flights');

  const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const oneWay = { origin: 'del', destination: 'bom', departureDate: daysAhead(30) };

  beforeAll(async () => {
    app = await createTestApp({ supplier: new MockSupplier(), fx });
    redis = app.get<Redis>(REDIS_CLIENT);
    prisma = app.get<PrismaClient>(PRISMA);
    // Start from an empty flights cache: a previous run leaves cached searches (breaks the
    // `cached: false` assertion) and re-priced offers (LHR→STN would then compare against the
    // already-raised price). Delete only this suite's keys — never FLUSHALL.
    await deleteKeys(redis, 'flights:*');
    await deleteKeys(redis, `fx:rate:v1:${fx.name}:*`);
    await prisma.fxRate.deleteMany({ where: { source: fx.name } });
  });

  afterAll(async () => {
    await prisma?.fxRate.deleteMany({ where: { source: fx.name } });
    await app?.close();
  });

  const search = (body: object) =>
    request(app.getHttpServer()).post('/v1/flights/search').send(body);
  const getOffer = (id: string) => request(app.getHttpServer()).get(`/v1/flights/offers/${id}`);

  const expectNoSupplierRef = (offers: unknown[]) => {
    for (const offer of offers) expect(offer).not.toHaveProperty('supplierRef');
  };

  it('one-way → 200, offers sorted by INR display price, no supplierRef', async () => {
    const res = await search(oneWay).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const offers = res.body.data as PublicFlightOffer[];
    expect(offers.length).toBeGreaterThan(0);
    expect(res.body.meta).toEqual({
      supplier: 'mock',
      cached: false,
      count: offers.length,
      currency: 'USD',
      displayCurrency: 'INR',
      demo: true,
    });
    for (let i = 1; i < offers.length; i++) {
      expect(compareMoney(offers[i - 1].displayPrice.total, offers[i].displayPrice.total)).toBeLessThanOrEqual(0);
    }
    // USD → INR at 83.5 × 1.02, rounded up to the whole rupee.
    expect(offers[0].displayPrice.total.currency).toBe('INR');
    expect(offers[0].displayPrice.total.amount).toMatch(/^\d+\.00$/);
    expect(offers[0].slices).toHaveLength(1);
    expectNoSupplierRef(offers);
  });

  it('second identical search → meta.cached true', async () => {
    const res = await search(oneWay).expect(200);
    expect(res.body.meta.cached).toBe(true);
    expectNoSupplierRef(res.body.data);
  });

  it('INR-priced offers pass through exactly (no buffer, paise kept)', async () => {
    const res = await search({ ...oneWay, currency: 'INR' }).expect(200);
    for (const offer of res.body.data as PublicFlightOffer[]) expect(offer.displayPrice.total).toEqual(offer.price.total);
  });

  it('round trip → 2 slices per offer', async () => {
    const res = await search({ ...oneWay, returnDate: daysAhead(37) }).expect(200);
    for (const offer of res.body.data as PublicFlightOffer[]) expect(offer.slices).toHaveLength(2);
  });

  it('PVD→RAI → 200 with no offers', async () => {
    const res = await search({ ...oneWay, origin: 'PVD', destination: 'RAI' }).expect(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toMatchObject({ count: 0, currency: null });
  });

  it('STN→LHR (supplier timeout) → 504', async () => {
    const res = await search({ ...oneWay, origin: 'STN', destination: 'LHR' }).expect(504);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['origin = destination', { origin: 'DEL', destination: 'del' }, 'destination'],
    ['past departure date', { departureDate: '2020-01-01' }, 'departureDate'],
    ['infants > adults', { adults: 1, infants: 2 }, 'infants'],
    ['return before departure', { returnDate: daysAhead(10) }, 'returnDate'],
    ['bad IATA code', { origin: 'DE1' }, 'origin'],
    ['adults + children > 9', { adults: 5, children: 5 }, 'children'],
  ])('%s → 400', async (_name, override, path) => {
    const res = await search({ ...oneWay, ...override }).expect(400);
    expect(res.body.message).toBe('Validation failed');
    expect(res.body.issues.map((i: { path: string }) => i.path)).toContain(path);
  });

  it('GET offer by id → 200 re-priced, unchanged, no supplierRef', async () => {
    const { body } = await search(oneWay).expect(200);
    const first = body.data[0] as PublicFlightOffer;
    const res = await getOffer(first.id).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.meta).toEqual({ supplier: 'mock', demo: true });
    expect(res.body.data.id).toBe(first.id);
    expect(res.body.data.priceChanged).toBe(false);
    expect(res.body.data.price.total).toEqual(first.price.total);
    expect(res.body.data.displayPrice).toEqual({ total: first.displayPrice.total });
    expectNoSupplierRef([res.body.data]);
  });

  it('LHR→STN offer → priceChanged true with a higher total (supplier + INR)', async () => {
    const { body } = await search({ ...oneWay, origin: 'LHR', destination: 'STN' }).expect(200);
    const first = body.data[0] as PublicFlightOffer;
    const res = await getOffer(first.id).expect(200);
    const priced = res.body.data as PublicPricedOffer;
    expect(priced.priceChanged).toBe(true);
    expect(priced.previousTotal).toEqual(first.price.total);
    expect(compareMoney(priced.price.total, first.price.total)).toBe(1);
    expect(priced.displayPrice.previousTotal).toEqual(first.displayPrice.total);
    expect(compareMoney(priced.displayPrice.total, first.displayPrice.total)).toBe(1);
  });

  it('longest mock offer id (round trip, premium_economy, currency) passes validation → 200', async () => {
    const { body } = await search({
      ...oneWay,
      returnDate: daysAhead(37),
      adults: 9,
      infants: 9,
      cabin: 'premium_economy',
      currency: 'EUR',
    }).expect(200);
    const first = body.data[0] as PublicFlightOffer;
    const res = await getOffer(first.id).expect(200);
    expect(res.body.data.priceChanged).toBe(false);
  });

  it('unknown offer id → 410', async () => {
    const res = await getOffer('mock:mk_unknown_0').expect(410);
    expect(res.body.message).toMatch(/search again/i);
    expect(res.body.code).toBe('FARE_NO_LONGER_AVAILABLE');
  });

  it('malformed offer id → 400', async () => {
    await getOffer('not-an-offer-id').expect(400);
  });

  it('FX API down: stored rate < 48h is used; none → 503 FX_UNAVAILABLE for non-INR offers only', async () => {
    const body = { ...oneWay, departureDate: daysAhead(50), currency: 'GBP' };
    // Warm: one successful fetch persists the rate.
    await search(body).expect(200);
    await deleteKeys(redis, `fx:rate:v1:${fx.name}:*`);
    fx.down = true;
    try {
      const fallback = await search({ ...body, departureDate: daysAhead(51) }).expect(200);
      expect(fallback.body.data[0].displayPrice.total.currency).toBe('INR');

      // Stored rate too old → no usable rate.
      await deleteKeys(redis, `fx:rate:v1:${fx.name}:*`);
      await prisma.fxRate.updateMany({ where: { source: fx.name }, data: { fetchedAt: new Date(Date.now() - 49 * 3_600_000) } });
      const res = await search({ ...body, departureDate: daysAhead(52) }).expect(503);
      expect(res.body.code).toBe('FX_UNAVAILABLE');
      // INR needs no rate at all.
      await search({ ...body, departureDate: daysAhead(52), currency: 'INR' }).expect(200);
    } finally {
      fx.down = false;
    }
  });
});
