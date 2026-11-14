import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@ota/db';
import { compareMoney, MockSupplier, sumMoney, type FlightOffer, type Money } from '@ota/suppliers';
import type { PublicBooking, SeatMap, UpdateBookingDetailsInput } from '@ota/contracts';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { REDIS_CLIENT } from './../src/redis/redis.module.js';
import { PRISMA } from './../src/prisma/prisma.module.js';
import { SUPPLIER_ADAPTER } from './../src/flights/supplier.provider.js';

// Offline MockSupplier with a movable clock (the LGW→LHR late-booking scenario depends on it).
// Requires Postgres (migrated) + Redis. Routes differ from flights.e2e so parallel files don't
// share cached searches.
describe('Bookings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let clockShiftMs = 0;
  const mock = new MockSupplier({ now: () => Date.now() + clockShiftMs });
  const created: string[] = [];

  const day = 86_400_000;
  const daysAhead = (n: number) => new Date(Date.now() + n * day).toISOString().slice(0, 10);
  const yearsAgo = (n: number) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - n);
    return d.toISOString().slice(0, 10);
  };
  const PASSPORT = 'P9876543';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SUPPLIER_ADAPTER)
      .useValue(mock)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get<PrismaClient>(PRISMA);

    const redis = app.get<Redis>(REDIS_CLIENT);
    if (redis.status !== 'ready') await new Promise<void>((resolve) => redis.once('ready', () => resolve()));
    // Only this suite's keys — never FLUSHALL.
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'bookings:*', 'COUNT', 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  });

  afterEach(() => {
    clockShiftMs = 0;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (prisma && created.length) await prisma.booking.deleteMany({ where: { id: { in: created } } });
    await app?.close();
  });

  const api = () => request(app.getHttpServer());

  async function firstOffer(body: object): Promise<FlightOffer> {
    const res = await api().post('/v1/flights/search').send(body).expect(200);
    return res.body.data[0];
  }

  async function createBooking(offer: FlightOffer) {
    const res = await api().post('/v1/bookings').send({ offerId: offer.id }).expect(201);
    created.push(res.body.data.id);
    return { id: res.body.data.id as string, token: res.body.meta.guestToken as string, res };
  }

  const as = (token: string) => ({
    get: (path: string) => api().get(path).set('X-Booking-Token', token),
    put: (path: string, body: object) => api().put(path).set('X-Booking-Token', token).send(body),
    post: (path: string, key?: string) => {
      const req = api().post(path).set('X-Booking-Token', token);
      return key ? req.set('Idempotency-Key', key) : req;
    },
  });

  function details(offer: FlightOffer, opts: { familyName?: string; passport?: boolean; services?: Array<{ serviceId: string; quantity: number }>; insurance?: boolean } = {}): UpdateBookingDetailsInput {
    const adults = offer.passengers.filter((p) => p.type === 'adult');
    let infantIdx = 0;
    return {
      passengers: offer.passengers.map((p, i) => ({
        ref: p.ref,
        type: p.type,
        title: p.type === 'adult' ? 'mr' : 'miss',
        gender: p.type === 'adult' ? 'm' : 'f',
        givenName: `Traveller ${String.fromCharCode(65 + i)}`,
        familyName: i === 0 && opts.familyName ? opts.familyName : 'Tester',
        dateOfBirth: p.type === 'adult' ? '1985-03-15' : p.type === 'child' ? yearsAgo(8) : yearsAgo(1),
        nationality: 'GB',
        document: opts.passport === false ? null : { type: 'passport', number: PASSPORT, issuingCountry: 'GB', expiryDate: '2035-01-01' },
        ...(p.type === 'infant' ? { associatedAdultRef: adults[infantIdx++].ref } : {}),
      })),
      contact: { title: 'mr', givenName: 'Traveller', familyName: 'Tester', email: 'guest@e2e.test', phone: '+442080160509' },
      services: opts.services ?? [],
      insurance: opts.insurance ? { quoteId: 'demo-travel-protection' } : null,
    };
  }

  function firstAvailableSeat(maps: SeatMap[], passengerRef: string): string {
    for (const row of maps[0].cabins[0].rows) {
      for (const el of row.sections.flatMap((s) => s.elements)) {
        if (el.type !== 'seat') continue;
        const svc = el.services.find((s) => s.passengerRef === passengerRef && s.price.amount !== '0.00');
        if (svc) return svc.serviceId;
      }
    }
    throw new Error('no seat');
  }

  /** A booking ready to confirm (PENDING_PAYMENT), one adult, international (passport). */
  async function readyToConfirm(familyName = 'Tester', route = { origin: 'SIN', destination: 'NRT' }) {
    const offer = await firstOffer({ ...route, departureDate: daysAhead(30) });
    const { id, token } = await createBooking(offer);
    await as(token).put(`/v1/bookings/${id}/details`, details(offer, { familyName })).expect(200);
    await as(token).post(`/v1/bookings/${id}/checkout`).expect(200);
    return { offer, id, token };
  }

  const expectNoSecrets = (body: unknown) => {
    const json = JSON.stringify(body);
    expect(json).not.toContain(PASSPORT);
    expect(json).not.toContain('supplierRef');
    expect(json).not.toContain('guestTokenHash');
    expect(json).not.toContain('supplierOrderId');
  };

  it('happy path: one-way 1 adult with bag + seat + insurance → CONFIRMED with PNR', async () => {
    const offer = await firstOffer({ origin: 'SIN', destination: 'NRT', departureDate: daysAhead(30) });
    const { id, token, res: createRes } = await createBooking(offer);
    expect(createRes.headers['cache-control']).toBe('no-store');
    expect(createRes.body.meta).toMatchObject({ priceChanged: false });
    expect(createRes.body.meta.guestToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const draft = createRes.body.data as PublicBooking;
    expect(draft).toMatchObject({ status: 'DRAFT', supplier: 'mock', demo: true, passengers: [], contact: null });
    expect(draft.reference).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(draft.price.total).toEqual(offer.price.total);
    expect(draft.insurance.quotes[0]).toMatchObject({ quoteId: 'demo-travel-protection', demo: true });
    expectNoSecrets(createRes.body);

    const anc = await as(token).get(`/v1/bookings/${id}/ancillaries`).expect(200);
    expect(anc.headers['cache-control']).toBe('no-store');
    const bag = anc.body.data.bags.find((b: { weightKg: number }) => b.weightKg === 23);
    expect(anc.body.data.seatsAvailable).toBe(true);
    const maps = await as(token).get(`/v1/bookings/${id}/seat-maps`).expect(200);
    const seatId = firstAvailableSeat(maps.body.data, offer.passengers[0].ref);

    const put = await as(token)
      .put(`/v1/bookings/${id}/details`, details(offer, { services: [{ serviceId: bag.serviceId, quantity: 1 }, { serviceId: seatId, quantity: 1 }], insurance: true }))
      .expect(200);
    const withDetails = put.body.data as PublicBooking;
    expect(put.body.meta.warnings).toEqual([]);
    expect(withDetails.passengers[0].document?.numberMasked).toBe('*****543');
    expect(withDetails.ancillaries.map((a) => a.label)).toEqual(['1 × 23kg checked bag', expect.stringMatching(/^Seat \d+[A-F]$/), 'Travel Protection (Demo)']);
    const p = withDetails.price;
    expect(p.ancillaries.amount).not.toBe('0.00');
    expect(p.insurance.amount).not.toBe('0.00');
    expect(p.total).toEqual(sumMoney([p.fare, p.ancillaries, p.insurance], 'USD'));
    expectNoSecrets(put.body);

    const checkout = await as(token).post(`/v1/bookings/${id}/checkout`).expect(200);
    expect(checkout.body.data.status).toBe('PENDING_PAYMENT');

    const confirm = await as(token).post(`/v1/bookings/${id}/confirm-demo`, 'happy-path-key-1').expect(200);
    const done = confirm.body.data as PublicBooking;
    expect(done.status).toBe('CONFIRMED');
    expect(done.pnr).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(done.insurance.policyNumber).toBe(`DEMO-${done.reference}`);
    expect(done.confirmedAt).not.toBeNull();
    expectNoSecrets(confirm.body);

    const get = await as(token).get(`/v1/bookings/${id}`).expect(200);
    expect(get.body.data).toMatchObject({ status: 'CONFIRMED', pnr: done.pnr });
    expectNoSecrets(get.body);

    const events = await prisma.bookingEvent.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'asc' } });
    expect(events.filter((e) => e.fromStatus !== e.toStatus).map((e) => e.toStatus)).toEqual(['DRAFT', 'PENDING_PAYMENT', 'CONFIRMING', 'CONFIRMED']);
    expect(JSON.stringify(events)).not.toContain(PASSPORT);
  });

  it('round trip 2 adults + 1 child + 1 infant → CONFIRMED', async () => {
    const offer = await firstOffer({ origin: 'CDG', destination: 'JFK', departureDate: daysAhead(30), returnDate: daysAhead(37), adults: 2, children: 1, infants: 1 });
    expect(offer.passengers.map((p) => p.type)).toEqual(['adult', 'adult', 'child', 'infant']);
    const { id, token } = await createBooking(offer);
    const put = await as(token).put(`/v1/bookings/${id}/details`, details(offer)).expect(200);
    const pax = (put.body.data as PublicBooking).passengers;
    expect(pax.map((x) => x.type)).toEqual(['adult', 'adult', 'child', 'infant']);
    expect(pax[3].associatedAdultRef).toBe(offer.passengers[0].ref);
    await as(token).post(`/v1/bookings/${id}/checkout`).expect(200);
    const confirm = await as(token).post(`/v1/bookings/${id}/confirm-demo`, 'round-trip-key-1').expect(200);
    expect(confirm.body.data.status).toBe('CONFIRMED');
  });

  it('age category mismatch → 422 AGE_CATEGORY_MISMATCH', async () => {
    const offer = await firstOffer({ origin: 'CDG', destination: 'JFK', departureDate: daysAhead(30), adults: 1, children: 1 });
    const { id, token } = await createBooking(offer);
    const body = details(offer);
    body.passengers[1].dateOfBirth = yearsAgo(13); // a 13-year-old booked as a child
    const res = await as(token).put(`/v1/bookings/${id}/details`, body).expect(422);
    expect(res.body.code).toBe('AGE_CATEGORY_MISMATCH');
    expect(res.body.message).toMatch(/search again/i);
    expect(res.body.issues[0].path).toBe('passengers.1.dateOfBirth');
  });

  it('international trip without passport → 422 DOCUMENT_REQUIRED', async () => {
    const offer = await firstOffer({ origin: 'SIN', destination: 'NRT', departureDate: daysAhead(31) });
    const { id, token } = await createBooking(offer);
    const res = await as(token).put(`/v1/bookings/${id}/details`, details(offer, { passport: false })).expect(422);
    expect(res.body.code).toBe('DOCUMENT_REQUIRED');
  });

  it('missing, wrong or malformed token / id → 404', async () => {
    const offer = await firstOffer({ origin: 'SIN', destination: 'NRT', departureDate: daysAhead(30) });
    const { id } = await createBooking(offer);
    await api().get(`/v1/bookings/${id}`).expect(404);
    await as('wrong-token').get(`/v1/bookings/${id}`).expect(404);
    await as('wrong-token').put(`/v1/bookings/${id}/details`, details(offer)).expect(404);
    await as('x').get('/v1/bookings/not-a-uuid').expect(404);
    await as('x').get('/v1/bookings/01936d7e-0000-7000-8000-000000000000').expect(404);
  });

  it('confirm-demo is idempotent: same key → same result and one order; other key → 409', async () => {
    const { id, token } = await readyToConfirm();
    const spy = vi.spyOn(mock, 'createOrder');
    const [a, b] = await Promise.all([
      as(token).post(`/v1/bookings/${id}/confirm-demo`, 'same-key-123'),
      as(token).post(`/v1/bookings/${id}/confirm-demo`, 'same-key-123'),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    // The racing request either replays the result (200) or sees it still in flight (202).
    expect(statuses[0]).toBe(200);
    expect([200, 202]).toContain(statuses[1]);
    const again = await as(token).post(`/v1/bookings/${id}/confirm-demo`, 'same-key-123').expect(200);
    expect(again.body.data.pnr).toBe(a.status === 200 ? a.body.data.pnr : b.body.data.pnr);
    expect(spy).toHaveBeenCalledTimes(1);
    const other = await as(token).post(`/v1/bookings/${id}/confirm-demo`, 'other-key-456').expect(409);
    expect(other.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('confirm-demo without Idempotency-Key → 400', async () => {
    const { id, token } = await readyToConfirm();
    await as(token).post(`/v1/bookings/${id}/confirm-demo`).expect(400);
  });

  it('family name FAIL → 502, booking FAILED; replay with the same key → same error', async () => {
    const { id, token } = await readyToConfirm('FAIL');
    const res = await as(token).post(`/v1/bookings/${id}/confirm-demo`, 'fail-key-123').expect(502);
    expect(res.body.code).toBe('SUPPLIER_ERROR');
    const get = await as(token).get(`/v1/bookings/${id}`).expect(200);
    expect(get.body.data).toMatchObject({ status: 'FAILED', pnr: null, failure: { code: 'SUPPLIER_ERROR' } });
    const replay = await as(token).post(`/v1/bookings/${id}/confirm-demo`, 'fail-key-123').expect(502);
    expect(replay.body.code).toBe('SUPPLIER_ERROR');
  });

  it('family name PRICECHANGE → 422 PRICE_CHANGED with the new total', async () => {
    const { id, token } = await readyToConfirm('PRICECHANGE');
    const res = await as(token).post(`/v1/bookings/${id}/confirm-demo`, 'price-key-123').expect(422);
    expect(res.body.code).toBe('PRICE_CHANGED');
    const prev = res.body.previousTotal as Money;
    const next = res.body.newTotal as Money;
    expect(compareMoney(next, prev)).toBe(1);
    expect((await as(token).get(`/v1/bookings/${id}`)).body.data.status).toBe('FAILED');
  });

  it('supplier timeout → 202 CONFIRMING; GET settles via retrieveOrder → CONFIRMED (no second order)', async () => {
    const { id, token } = await readyToConfirm('TIMEOUT');
    const create = vi.spyOn(mock, 'createOrder');
    const res = await as(token).post(`/v1/bookings/${id}/confirm-demo`, 'timeout-key-1').expect(202);
    expect(res.body.data.status).toBe('CONFIRMING');
    const get = await as(token).get(`/v1/bookings/${id}`).expect(200);
    expect(get.body.data.status).toBe('CONFIRMED');
    expect(get.body.data.pnr).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('expired offer: unknown offer → 410; booking read after expiry → EXPIRED, edits → 410', async () => {
    await api().post('/v1/bookings').send({ offerId: 'mock:unknown' }).expect(410);
    const offer = await firstOffer({ origin: 'SIN', destination: 'NRT', departureDate: daysAhead(30) });
    const { id, token } = await createBooking(offer);
    await prisma.booking.update({ where: { id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } });
    const get = await as(token).get(`/v1/bookings/${id}`).expect(200);
    expect(get.body.data.status).toBe('EXPIRED');
    const put = await as(token).put(`/v1/bookings/${id}/details`, details(offer)).expect(410);
    expect(put.body.code).toBe('BOOKING_EXPIRED');
  });

  it('details after checkout → 409 ILLEGAL_STATE', async () => {
    const { offer, id, token } = await readyToConfirm();
    const res = await as(token).put(`/v1/bookings/${id}/details`, details(offer)).expect(409);
    expect(res.body.code).toBe('ILLEGAL_STATE');
  });

  describe('checkout re-price (mock LGW→LHR: fare +10% and 23kg bags gone within 14 days)', () => {
    async function lateDraft(bagKg: 15 | 23) {
      const offer = await firstOffer({ origin: 'LGW', destination: 'LHR', departureDate: daysAhead(40) });
      const { id, token } = await createBooking(offer);
      const anc = await as(token).get(`/v1/bookings/${id}/ancillaries`).expect(200);
      const bag = anc.body.data.bags.find((b: { weightKg: number }) => b.weightKg === bagKg);
      await as(token).put(`/v1/bookings/${id}/details`, details(offer, { services: [{ serviceId: bag.serviceId, quantity: 1 }], insurance: true })).expect(200);
      return { id, token, bagId: bag.serviceId as string };
    }

    it('fare moved → 422 PRICE_CHANGED, stays DRAFT with new amounts; checkout again accepts', async () => {
      const { id, token } = await lateDraft(15);
      const before = (await as(token).get(`/v1/bookings/${id}`)).body.data as PublicBooking;
      clockShiftMs = 30 * day; // departure now 10 days away
      const res = await as(token).post(`/v1/bookings/${id}/checkout`).expect(422);
      expect(res.body.code).toBe('PRICE_CHANGED');
      expect(res.body.previousTotal).toEqual(before.price.total);
      expect(compareMoney(res.body.newTotal, before.price.total)).toBe(1);

      const after = (await as(token).get(`/v1/bookings/${id}`)).body.data as PublicBooking;
      expect(after.status).toBe('DRAFT');
      expect(after.price.total).toEqual(res.body.newTotal);
      expect(after.offer.price.total).toEqual(after.price.fare);
      const ok = await as(token).post(`/v1/bookings/${id}/checkout`).expect(200);
      expect(ok.body.data.status).toBe('PENDING_PAYMENT');
      const events = await prisma.bookingEvent.findMany({ where: { bookingId: id, message: 'Price changed at checkout' } });
      expect(events).toHaveLength(1);
    });

    it('selected add-on gone → 422 SERVICE_UNAVAILABLE listing it; stays DRAFT', async () => {
      const { id, token, bagId } = await lateDraft(23);
      clockShiftMs = 30 * day;
      const res = await as(token).post(`/v1/bookings/${id}/checkout`).expect(422);
      expect(res.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE', serviceIds: [bagId] });
      expect((await as(token).get(`/v1/bookings/${id}`)).body.data.status).toBe('DRAFT');
    });
  });
});
