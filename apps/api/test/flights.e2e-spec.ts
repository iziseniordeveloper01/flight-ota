import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { Redis } from 'ioredis';
import { compareMoney, MockSupplier, type FlightOffer } from '@ota/suppliers';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { REDIS_CLIENT } from './../src/redis/redis.module.js';
import { SUPPLIER_ADAPTER } from './../src/flights/supplier.provider.js';

// Always the offline mock, whatever SUPPLIER says in .env. Requires Redis running.
describe('Flights (e2e)', () => {
  let app: INestApplication<App>;

  const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const oneWay = { origin: 'del', destination: 'bom', departureDate: daysAhead(30) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SUPPLIER_ADAPTER)
      .useValue(new MockSupplier())
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const redis = app.get<Redis>(REDIS_CLIENT);
    if (redis.status !== 'ready') {
      await new Promise<void>((resolve) => redis.once('ready', () => resolve()));
    }
    // Start from an empty flights cache: a previous run leaves cached searches (breaks the
    // `cached: false` assertion) and re-priced offers (LHR→STN would then compare against the
    // already-raised price). Delete only flights keys — never FLUSHALL.
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'flights:*', 'COUNT', 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  });

  afterAll(async () => {
    await app?.close();
  });

  const search = (body: object) =>
    request(app.getHttpServer()).post('/v1/flights/search').send(body);
  const getOffer = (id: string) => request(app.getHttpServer()).get(`/v1/flights/offers/${id}`);

  const expectNoSupplierRef = (offers: unknown[]) => {
    for (const offer of offers) expect(offer).not.toHaveProperty('supplierRef');
  };

  it('one-way → 200, offers sorted by total price, no supplierRef', async () => {
    const res = await search(oneWay).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const offers = res.body.data as FlightOffer[];
    expect(offers.length).toBeGreaterThan(0);
    expect(res.body.meta).toEqual({
      supplier: 'mock',
      cached: false,
      count: offers.length,
      currency: 'USD',
      demo: true,
    });
    for (let i = 1; i < offers.length; i++) {
      expect(compareMoney(offers[i - 1].price.total, offers[i].price.total)).toBeLessThanOrEqual(0);
    }
    expect(offers[0].slices).toHaveLength(1);
    expectNoSupplierRef(offers);
  });

  it('second identical search → meta.cached true', async () => {
    const res = await search(oneWay).expect(200);
    expect(res.body.meta.cached).toBe(true);
    expectNoSupplierRef(res.body.data);
  });

  it('round trip → 2 slices per offer', async () => {
    const res = await search({ ...oneWay, returnDate: daysAhead(37) }).expect(200);
    for (const offer of res.body.data as FlightOffer[]) expect(offer.slices).toHaveLength(2);
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
    const first = body.data[0] as FlightOffer;
    const res = await getOffer(first.id).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.meta).toEqual({ supplier: 'mock', demo: true });
    expect(res.body.data.id).toBe(first.id);
    expect(res.body.data.priceChanged).toBe(false);
    expect(res.body.data.price.total).toEqual(first.price.total);
    expectNoSupplierRef([res.body.data]);
  });

  it('LHR→STN offer → priceChanged true with a higher total', async () => {
    const { body } = await search({ ...oneWay, origin: 'LHR', destination: 'STN' }).expect(200);
    const first = body.data[0] as FlightOffer;
    const res = await getOffer(first.id).expect(200);
    expect(res.body.data.priceChanged).toBe(true);
    expect(res.body.data.previousTotal).toEqual(first.price.total);
    expect(compareMoney(res.body.data.price.total, first.price.total)).toBe(1);
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
    const first = body.data[0] as FlightOffer;
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
});
