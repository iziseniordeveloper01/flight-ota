import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaClient } from '@ota/db';
import type { PaymentOrder, PublicBooking, PublicFlightOffer, UpdateBookingDetailsInput } from '@ota/contracts';
import { MockSupplier } from '@ota/suppliers';
import { PRISMA } from './../src/prisma/prisma.module.js';
import { FakePaymentProvider } from './../src/payments/fake-payment.provider.js';
import { PaymentsService } from './../src/payments/payments.service.js';
import { ReconciliationService } from './../src/payments/reconciliation.service.js';
import { TicketingService } from './../src/bookings/ticketing.service.js';
import { JobQueue } from './../src/queues/job-queue.service.js';
import { CapturingTransport, createTestApp, deleteBookings, waitFor } from './test-app.js';

// Real payment flow with the in-memory FakePaymentProvider (same signature scheme as Razorpay, no
// network), MockSupplier (USD → INR at fixed rates), workers ON (own queue prefix) and a capturing
// mail transport. Requires Postgres (migrated) + Redis.
describe('Payments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jobs: JobQueue;
  const mock = new MockSupplier();
  const fake = new FakePaymentProvider();
  const mail = new CapturingTransport();
  const created: string[] = [];
  const PASSPORT = 'P7654321';
  const EMAIL = 'payer@e2e.test';
  const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  let dayOffset = 60;

  beforeAll(async () => {
    app = await createTestApp({ supplier: mock, payment: fake, mail, workers: true });
    prisma = app.get<PrismaClient>(PRISMA);
    jobs = app.get(JobQueue);
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    if (prisma) await deleteBookings(prisma, created);
    if (jobs) {
      for (const q of [jobs.ticketing, jobs.webhooks, jobs.refunds, jobs.emails, jobs.maintenance]) {
        await q.obliterate({ force: true }).catch(() => undefined);
      }
    }
    await app?.close();
  });

  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (path: string) => api().get(path).set('X-Booking-Token', token),
    post: (path: string, body?: object) => api().post(path).set('X-Booking-Token', token).send(body ?? {}),
  });

  function details(offer: PublicFlightOffer, familyName = 'Payer'): UpdateBookingDetailsInput {
    return {
      passengers: offer.passengers.map((p) => ({
        ref: p.ref,
        type: p.type,
        title: 'mrs',
        gender: 'f',
        givenName: 'Priya',
        familyName,
        dateOfBirth: '1988-07-21',
        nationality: 'IN',
        document: { type: 'passport', number: PASSPORT, issuingCountry: 'IN', expiryDate: '2034-01-01' },
      })),
      contact: { title: 'mrs', givenName: 'Priya', familyName, email: EMAIL, phone: '+919876543210' },
      services: [],
      insurance: null,
    };
  }

  /** A PENDING_PAYMENT booking (international, 1 adult). Each call searches a new date → fresh offer request. */
  async function readyToPay(familyName = 'Payer') {
    const search = await api().post('/v1/flights/search').send({ origin: 'BOM', destination: 'DXB', departureDate: daysAhead(dayOffset++) }).expect(200);
    const offer = search.body.data[0] as PublicFlightOffer;
    const res = await api().post('/v1/bookings').send({ offerId: offer.id }).expect(201);
    const id = res.body.data.id as string;
    const token = res.body.meta.guestToken as string;
    created.push(id);
    await api().put(`/v1/bookings/${id}/details`).set('X-Booking-Token', token).send(details(offer, familyName)).expect(200);
    const checkout = await as(token).post(`/v1/bookings/${id}/checkout`).expect(200);
    return { id, token, booking: checkout.body.data as PublicBooking };
  }

  async function paymentOrder(id: string, token: string): Promise<PaymentOrder> {
    return (await as(token).post(`/v1/bookings/${id}/payment-order`).expect(201)).body.data as PaymentOrder;
  }

  async function statusOf(id: string, token: string): Promise<PublicBooking> {
    return (await as(token).get(`/v1/bookings/${id}`).expect(200)).body.data as PublicBooking;
  }

  const waitStatus = (id: string, token: string, status: string, timeoutMs = 15_000) =>
    waitFor(async () => {
      const b = await statusOf(id, token);
      return b.status === status ? b : null;
    }, timeoutMs, `booking ${status}`);

  function webhook(eventId: string, event: string, payload: Record<string, { entity: object }>, signature?: string) {
    const body = JSON.stringify({ entity: 'event', account_id: 'acc_test', event, contains: Object.keys(payload), payload, created_at: Math.floor(Date.now() / 1000) });
    return api()
      .post('/v1/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', signature ?? fake.signWebhook(body))
      .set('X-Razorpay-Event-Id', eventId)
      .send(body);
  }

  const paymentEntity = (orderId: string, paymentId: string, amountMinor: bigint, status = 'captured') => ({
    entity: { id: paymentId, entity: 'payment', order_id: orderId, amount: Number(amountMinor), currency: 'INR', status, method: 'upi', email: EMAIL, contact: '+919876543210', error_code: status === 'failed' ? 'BAD_REQUEST_ERROR' : null },
  });

  const mailsTo = (subjectPart: string) => mail.sent.filter((m) => m.to === EMAIL && m.subject.includes(subjectPart));

  it('pay → verify → 202 PAID → ticketing worker → CONFIRMED + confirmation email', async () => {
    const { id, token, booking } = await readyToPay();
    expect(booking.payment).toEqual({ provider: 'fake', refund: null });
    const createOrder = vi.spyOn(mock, 'createOrder');

    const order = await paymentOrder(id, token);
    // The amount is the server's INR total, never the client's.
    expect(order).toMatchObject({ provider: 'fake', keyId: 'rzp_test_fake', amount: booking.displayPrice.total, currency: 'INR', name: 'SkyFare' });
    expect(BigInt(order.amountMinor)).toBe(BigInt(booking.displayPrice.total.amount.replace('.', '')));
    expect(order.prefill).toEqual({ name: 'Priya Payer', email: EMAIL, contact: '+919876543210' });
    expect(order.timeoutSeconds).toBeGreaterThan(60);
    const sent = fake.orders.get(order.orderId)!;
    expect(sent.receipt).toBe(`${booking.reference}-1`);
    expect(sent.notes).toEqual({ bookingId: id, reference: booking.reference }); // no PII in notes

    const paid = fake.pay(order.orderId);
    const verify = await as(token).post(`/v1/bookings/${id}/payment-verify`, paid).expect(202);
    expect(['PAID', 'CONFIRMING', 'CONFIRMED']).toContain(verify.body.data.status);

    const done = await waitStatus(id, token, 'CONFIRMED');
    expect(done.pnr).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId: id } });
    expect(payment).toMatchObject({ status: 'CAPTURED', provider: 'fake', currency: 'INR', attempt: 1 });
    expect(payment.amount.toFixed(2)).toBe(booking.displayPrice.total.amount);
    // createOrder was given the SUPPLIER total (USD), not the INR amount.
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].expectedTotal.currency).toBe('USD');

    const [email] = await waitFor(async () => (mailsTo('is confirmed').length ? mailsTo('is confirmed') : null), 10_000, 'confirmation email');
    expect(email.subject).toContain(booking.reference);
    expect(email.html).toContain(done.pnr!);
    expect(email.text).toContain('Mrs Priya Payer');
    expect(email.text).toContain('₹');
    expect(`${email.html}${email.text}`).not.toContain(PASSPORT);
    expect(`${email.html}${email.text}`).not.toContain('1988-07-21');

    const events = await prisma.bookingEvent.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'asc' } });
    expect(events.filter((e) => e.fromStatus !== e.toStatus).map((e) => e.toStatus)).toEqual(['DRAFT', 'PENDING_PAYMENT', 'PAID', 'CONFIRMING', 'CONFIRMED']);
    expect(JSON.stringify(events)).not.toContain(PASSPORT);
    expect(JSON.stringify(events)).not.toContain(EMAIL);

    // Verifying the same payment again (double click, retry) is harmless: same status, no second order.
    const again = await as(token).post(`/v1/bookings/${id}/payment-verify`, paid).expect(202);
    expect(again.body.data.status).toBe('CONFIRMED');
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(await prisma.payment.count({ where: { bookingId: id } })).toBe(1);
  });

  it('confirm-demo → 404 when a real payment provider is configured', async () => {
    const { id, token } = await readyToPay();
    await as(token).post(`/v1/bookings/${id}/confirm-demo`).set('Idempotency-Key', 'demo-key-123').expect(404);
  });

  it('payment-order: 409 while DRAFT, 410 PAYMENT_WINDOW_CLOSED within 2 minutes of offer expiry', async () => {
    const search = await api().post('/v1/flights/search').send({ origin: 'BOM', destination: 'DXB', departureDate: daysAhead(dayOffset++) }).expect(200);
    const draft = await api().post('/v1/bookings').send({ offerId: search.body.data[0].id }).expect(201);
    created.push(draft.body.data.id);
    const illegal = await as(draft.body.meta.guestToken).post(`/v1/bookings/${draft.body.data.id}/payment-order`).expect(409);
    expect(illegal.body.code).toBe('ILLEGAL_STATE');

    const { id, token } = await readyToPay();
    await prisma.booking.update({ where: { id }, data: { offerExpiresAt: new Date(Date.now() + 90_000) } });
    const res = await as(token).post(`/v1/bookings/${id}/payment-order`).expect(410);
    expect(res.body.code).toBe('PAYMENT_WINDOW_CLOSED');
  });

  it('verify: another order id → 400, tampered signature → 400, amount mismatch → 400 — nothing is paid', async () => {
    const { id, token } = await readyToPay();
    const first = await paymentOrder(id, token);
    const second = await paymentOrder(id, token); // "Try again" = a new order; only the latest counts

    const stale = await as(token).post(`/v1/bookings/${id}/payment-verify`, fake.pay(first.orderId)).expect(400);
    expect(stale.body.code).toBe('PAYMENT_VERIFICATION_FAILED');

    const paid = fake.pay(second.orderId);
    const tampered = { ...paid, razorpay_signature: paid.razorpay_signature.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) };
    expect((await as(token).post(`/v1/bookings/${id}/payment-verify`, tampered).expect(400)).body.code).toBe('PAYMENT_VERIFICATION_FAILED');

    const third = await paymentOrder(id, token);
    const short = fake.pay(third.orderId, { amountMinor: BigInt(third.amountMinor) - 100n });
    expect((await as(token).post(`/v1/bookings/${id}/payment-verify`, short).expect(400)).body.code).toBe('PAYMENT_VERIFICATION_FAILED');

    expect((await statusOf(id, token)).status).toBe('PENDING_PAYMENT');
    expect(await prisma.payment.count({ where: { bookingId: id, status: 'CAPTURED' } })).toBe(0);
    // Malformed body → schema 400 before anything else.
    await as(token).post(`/v1/bookings/${id}/payment-verify`, { razorpay_payment_id: 'x' }).expect(400);
  });

  it('webhook: bad signature → 401; payment.captured → PAID → CONFIRMED; duplicate event id ignored', async () => {
    const { id, token } = await readyToPay();
    const order = await paymentOrder(id, token);
    const { razorpay_payment_id: paymentId } = fake.pay(order.orderId);
    const createOrder = vi.spyOn(mock, 'createOrder');
    const eventId = `evt_dup${Date.now()}`;
    const payload = { payment: paymentEntity(order.orderId, paymentId, BigInt(order.amountMinor)) };

    await webhook(eventId, 'payment.captured', payload, 'f'.repeat(64)).expect(401);
    expect(await prisma.webhookEvent.count({ where: { eventId } })).toBe(0);

    expect((await webhook(eventId, 'payment.captured', payload).expect(200)).body).toEqual({ received: true, duplicate: false });
    await waitStatus(id, token, 'CONFIRMED');
    expect((await webhook(eventId, 'payment.captured', payload).expect(200)).body).toEqual({ received: true, duplicate: true });
    // order.paid for the same payment (Razorpay sends both) changes nothing either.
    await webhook(`${eventId}b`, 'order.paid', { ...payload, order: { entity: { id: order.orderId } } }).expect(200);

    const row = await waitFor(async () => {
      const r = await prisma.webhookEvent.findUnique({ where: { eventId: `${eventId}b` } });
      return r?.processedAt ? r : null;
    }, 10_000, 'order.paid processed');
    expect(row.outcome).toBe('ALREADY');
    const stored = await prisma.webhookEvent.findUniqueOrThrow({ where: { eventId } });
    expect(stored).toMatchObject({ type: 'payment.captured', orderId: order.orderId, paymentId, outcome: 'PAID' });
    expect(JSON.stringify(stored, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(EMAIL); // no raw payload kept
    expect(createOrder).toHaveBeenCalledTimes(1);

    // Unknown events: 200 and ignored.
    expect((await webhook(`evt_unknown${Date.now()}`, 'payment.downtime.started', {}).expect(200)).body.received).toBe(true);
  });

  it('late payment on an EXPIRED booking → recorded, full refund (REFUND_PENDING) + "refund initiated" email', async () => {
    const { id, token, booking } = await readyToPay();
    const order = await paymentOrder(id, token);
    await prisma.booking.update({ where: { id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } });

    const res = await as(token).post(`/v1/bookings/${id}/payment-verify`, fake.pay(order.orderId)).expect(202);
    expect(res.body.data.status).toBe('REFUND_PENDING');
    const refund = await waitFor(async () => {
      const r = await prisma.refund.findFirst({ where: { payment: { bookingId: id } } });
      return r?.providerRefundId ? r : null;
    }, 10_000, 'refund sent to provider');
    expect(refund).toMatchObject({ reason: 'LATE_PAYMENT', status: 'PENDING', currency: 'INR' });
    expect(fake.refunds.get(refund.providerRefundId!)?.idempotencyKey).toBe(refund.id);
    expect((await prisma.payment.findFirstOrThrow({ where: { bookingId: id } })).status).toBe('REFUND_PENDING');

    const view = await statusOf(id, token);
    expect(view.status).toBe('REFUND_PENDING');
    expect(view.payment.refund).toEqual({ amount: booking.displayPrice.total, status: 'pending' });
    const [email] = await waitFor(async () => (mailsTo('refund started').length ? mailsTo('refund started') : null), 10_000, 'refund email');
    expect(email.text).toContain('after this fare had expired');
    const events = await prisma.bookingEvent.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'asc' } });
    expect(events.filter((e) => e.fromStatus !== e.toStatus).map((e) => e.toStatus)).toEqual(['DRAFT', 'PENDING_PAYMENT', 'EXPIRED', 'REFUND_PENDING']);
  });

  it('supplier failure after payment → FAILED → REFUND_PENDING → refund.processed webhook → REFUNDED + emails', async () => {
    const { id, token } = await readyToPay('FAIL'); // mock: family name FAIL → UPSTREAM_ERROR at createOrder
    const order = await paymentOrder(id, token);
    await as(token).post(`/v1/bookings/${id}/payment-verify`, fake.pay(order.orderId)).expect(202);

    const pending = await waitStatus(id, token, 'REFUND_PENDING');
    expect(pending.failure).toMatchObject({ code: 'SUPPLIER_ERROR' });
    const refund = await waitFor(async () => {
      const r = await prisma.refund.findFirst({ where: { payment: { bookingId: id } } });
      return r?.providerRefundId ? r : null;
    }, 10_000, 'refund sent');
    expect(refund.reason).toBe('BOOKING_FAILED');
    await waitFor(async () => (mailsTo('refund started').some((m) => m.text.includes("couldn't confirm your ticket")) ? true : null), 10_000, 'failed email');

    fake.setRefundStatus(refund.providerRefundId!, 'processed');
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId: id } });
    await webhook(`evt_rfnd${Date.now()}`, 'refund.processed', {
      refund: { entity: { id: refund.providerRefundId, entity: 'refund', payment_id: payment.providerPaymentId, amount: order.amountMinor, status: 'processed', notes: [] } },
      payment: paymentEntity(order.orderId, payment.providerPaymentId!, BigInt(order.amountMinor), 'refunded'),
    }).expect(200);

    const refunded = await waitStatus(id, token, 'REFUNDED');
    expect(refunded.payment.refund?.status).toBe('processed');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REFUNDED');
    await waitFor(async () => (mailsTo('is complete').length ? true : null), 10_000, 'refund completed email');
    const events = await prisma.bookingEvent.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'asc' } });
    expect(events.filter((e) => e.fromStatus !== e.toStatus).map((e) => e.toStatus)).toEqual(['DRAFT', 'PENDING_PAYMENT', 'PAID', 'CONFIRMING', 'FAILED', 'REFUND_PENDING', 'REFUNDED']);
  });

  it('markPaid is idempotent under concurrency; a second captured payment is refunded, the booking untouched', async () => {
    const { id, token } = await readyToPay();
    const first = await paymentOrder(id, token);
    const second = await paymentOrder(id, token);
    const payments = app.get(PaymentsService);
    const a = fake.pay(first.orderId);
    const b = fake.pay(second.orderId);
    const paidB = { paymentId: b.razorpay_payment_id, amountMinor: BigInt(second.amountMinor), currency: 'INR', method: 'card' };

    const outcomes = await Promise.all([1, 2, 3].map(() => payments.markPaid(second.orderId, paidB, 'webhook')));
    expect(outcomes.sort()).toEqual(['ALREADY', 'ALREADY', 'PAID']);
    await waitStatus(id, token, 'CONFIRMED');

    // The customer also completed the older checkout: money arrives for a booking that is already paid.
    const dup = await payments.markPaid(first.orderId, { paymentId: a.razorpay_payment_id, amountMinor: BigInt(first.amountMinor), currency: 'INR', method: 'card' }, 'webhook');
    expect(dup).toBe('REFUNDING');
    const refund = await prisma.refund.findFirstOrThrow({ where: { payment: { providerOrderId: first.orderId } } });
    expect(refund.reason).toBe('DUPLICATE_PAYMENT');
    expect((await statusOf(id, token)).status).toBe('CONFIRMED');
    expect(await prisma.payment.count({ where: { bookingId: id, status: 'CAPTURED' } })).toBe(1);
  });

  it('reconciliation re-enqueues a PAID booking whose ticketing job failed and is retained → CONFIRMED', async () => {
    const { id, token } = await readyToPay();
    const ticketing = app.get(TicketingService);
    // The job fails before the booking leaves PAID (e.g. a DB blip); attempts = 1, so it stays failed.
    vi.spyOn(ticketing, 'ticket').mockRejectedValueOnce(new Error('transient failure'));
    const order = await paymentOrder(id, token);
    await as(token).post(`/v1/bookings/${id}/payment-verify`, fake.pay(order.orderId)).expect(202);

    await waitFor(async () => {
      const job = await jobs.ticketing.getJob(id);
      return job && (await job.getState()) === 'failed' ? true : null;
    }, 10_000, 'ticketing job failed');
    expect((await statusOf(id, token)).status).toBe('PAID');
    // A plain add() with the same jobId would be silently ignored while the failed job is retained:
    await jobs.ticketing.add('ticket', { bookingId: id }, { jobId: id });
    expect(await (await jobs.ticketing.getJob(id))!.getState()).toBe('failed');

    const summary = await app.get(ReconciliationService).reconcile(new Date(Date.now() + 5 * 60_000));
    expect(summary.ticketingRequeued).toBeGreaterThanOrEqual(1);
    await waitStatus(id, token, 'CONFIRMED');
  });

  it('reconciliation finds money that arrived without verify or webhook → PAID → CONFIRMED', async () => {
    const { id, token } = await readyToPay();
    const order = await paymentOrder(id, token);
    fake.pay(order.orderId); // customer paid, but the browser closed and no webhook reached us
    expect((await statusOf(id, token)).status).toBe('PENDING_PAYMENT');
    const summary = await app.get(ReconciliationService).reconcile();
    expect(summary.paid).toBeGreaterThanOrEqual(1);
    await waitStatus(id, token, 'CONFIRMED');
  });
});
