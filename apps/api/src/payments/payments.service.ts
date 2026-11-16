import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BookingStatus, PaymentOrder, PaymentVerifyBody } from '@ota/contracts';
import type { Payment, PaymentStatus } from '@ota/db';
import { currencyDigits, fromMinor, toMinor } from '@ota/suppliers';
import { bookingError } from '../bookings/booking-errors.js';
import { BookingStore, isUniqueViolation, TX_OPTIONS } from '../bookings/booking-store.service.js';
import { displayPriceOf, hasChargeSnapshot } from '../bookings/booking-view.js';
import { BookingsService } from '../bookings/bookings.service.js';
import type { Env } from '../config/env.js';
import { JobQueue } from '../queues/job-queue.service.js';
import { PAYMENT_PROVIDER, PaymentProviderError, type PaymentProvider, type ProviderPayment } from './payment-provider.js';
import { RefundsService, type RefundReason } from './refunds.service.js';

/** A booking may not be paid when its offer expires sooner than this. */
export const MIN_PAYMENT_WINDOW_MS = 2 * 60_000;
export const MAX_PAYMENT_ATTEMPTS = 10;
// The checkout closes this long before the offer expires (so money never arrives for a dead offer).
const CHECKOUT_MARGIN_SECONDS = 60;
const PROVIDER_TIMEOUT_MS = 15_000;
/** Payment statuses after money arrived: markPaid() is a no-op for them. */
const SETTLED: readonly PaymentStatus[] = ['CAPTURED', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED'];

export interface PaidPayment {
  paymentId: string;
  amountMinor: bigint;
  currency: string;
  method: string | null;
}

export type MarkPaidOutcome = 'PAID' | 'REFUNDING' | 'ALREADY' | 'MISMATCH' | 'UNKNOWN_ORDER';

/**
 * Real payments. The amount is ALWAYS computed here from the booking (charge total), never taken
 * from the client. markPaid() is the single, idempotent entry point for "money arrived" — used by
 * payment-verify, the webhook and the reconciliation job.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly bookings: BookingsService,
    private readonly store: BookingStore,
    private readonly refunds: RefundsService,
    private readonly jobs: JobQueue,
    private readonly config: ConfigService<Env, true>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** POST /bookings/:id/payment-order — a fresh provider order per attempt ("Try again" = new order). */
  async createOrder(id: string, token: string | undefined): Promise<PaymentOrder> {
    this.requireRealProvider();
    const booking = await this.bookings.load(id, token);
    this.bookings.requireStatus(booking, 'PENDING_PAYMENT');
    if (!hasChargeSnapshot(booking)) {
      // Created before payments existed: no charge amount to take. Start again.
      throw bookingError(HttpStatus.CONFLICT, 'ILLEGAL_STATE', 'This booking can no longer be paid. Please start a new booking.');
    }
    const msLeft = booking.offerExpiresAt.getTime() - Date.now();
    if (msLeft < MIN_PAYMENT_WINDOW_MS) {
      throw bookingError(HttpStatus.GONE, 'PAYMENT_WINDOW_CLOSED', 'This fare expires in less than 2 minutes. Please search again.');
    }
    const attempt = booking.payments.length + 1;
    if (attempt > MAX_PAYMENT_ATTEMPTS) {
      throw bookingError(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_PAYMENT_ATTEMPTS', 'Too many payment attempts. Please start a new booking.');
    }

    const amount = displayPriceOf(booking).total;
    const digits = currencyDigits(amount.currency);
    const amountMinor = toMinor(amount.amount, digits);
    const order = await this.providerCall('createOrder', () =>
      this.provider.createOrder(
        { amountMinor, currency: amount.currency, receipt: `${booking.reference}-${attempt}`, notes: { bookingId: booking.id, reference: booking.reference } },
        { timeoutMs: PROVIDER_TIMEOUT_MS },
      ),
    );
    if (order.amountMinor !== amountMinor || order.currency !== amount.currency) {
      this.logger.error(`Provider order amount differs booking=${booking.id} order=${order.id}`);
      throw bookingError(HttpStatus.BAD_GATEWAY, 'PAYMENT_PROVIDER_ERROR', 'The payment provider returned an unexpected amount. Please try again.');
    }
    try {
      await this.store.prisma.payment.create({
        data: { bookingId: booking.id, attempt, provider: this.provider.name, providerOrderId: order.id, amount: amount.amount, currency: amount.currency },
      });
    } catch (err) {
      // Two tabs started a payment at once (same attempt number): let the customer retry.
      if (isUniqueViolation(err)) throw bookingError(HttpStatus.CONFLICT, 'ILLEGAL_STATE', 'A payment is already being started. Please try again.');
      throw err;
    }
    await this.store.recordEvent(this.store.prisma, booking.id, 'PENDING_PAYMENT', 'GUEST', 'Payment order created', {
      attempt,
      provider: this.provider.name,
      amount: { ...amount },
    });

    // Prefill only: what the customer typed in step 1 (never logged, never sent in notes).
    const prefill = {
      name: [booking.contactGivenName, booking.contactFamilyName].filter(Boolean).join(' '),
      email: booking.contactEmail ?? '',
      contact: booking.contactPhone ?? '',
    };
    return {
      provider: this.provider.name as PaymentOrder['provider'],
      keyId: this.provider.keyId,
      orderId: order.id,
      amount,
      amountMinor: Number(amountMinor),
      currency: amount.currency,
      name: this.config.get('BRAND_NAME', { infer: true }),
      description: `Flight booking ${booking.reference}`,
      prefill,
      timeoutSeconds: Math.max(60, Math.floor(msLeft / 1000) - CHECKOUT_MARGIN_SECONDS),
    };
  }

  /**
   * POST /bookings/:id/payment-verify — Checkout's success handler. The signature is checked
   * against OUR latest order id (never the client's), then the payment is re-fetched from the
   * provider: captured (or authorized → captured), same order, same amount and currency.
   */
  async verify(id: string, token: string | undefined, body: PaymentVerifyBody): Promise<BookingStatus> {
    this.requireRealProvider();
    // Lazy expiry may turn the booking EXPIRED here: markPaid then refunds the late payment.
    const booking = await this.bookings.load(id, token);
    const payment = booking.payments.at(-1);
    const failed = (message: string) => bookingError(HttpStatus.BAD_REQUEST, 'PAYMENT_VERIFICATION_FAILED', message);
    if (!payment || payment.providerOrderId !== body.razorpay_order_id) throw failed('This payment does not belong to the current payment attempt.');
    if (!this.provider.verifyCheckoutSignature(payment.providerOrderId, body.razorpay_payment_id, body.razorpay_signature)) {
      this.logger.warn(`Checkout signature mismatch booking=${booking.id}`);
      throw failed('The payment could not be verified.');
    }

    let remote = await this.providerCall('fetchPayment', () => this.provider.fetchPayment(body.razorpay_payment_id, { timeoutMs: PROVIDER_TIMEOUT_MS }));
    if (remote.orderId !== payment.providerOrderId || !this.sameAmount(payment, remote)) {
      this.logger.error(`Verified payment does not match the order booking=${booking.id} payment=${remote.id}`);
      throw failed('The payment amount does not match this booking.');
    }
    if (remote.status === 'authorized') {
      // Auto-capture is the Razorpay default for Orders API payments; capture if the account is manual.
      remote = await this.providerCall('capture', () => this.provider.capture(remote.id, remote.amountMinor, remote.currency, { timeoutMs: PROVIDER_TIMEOUT_MS }));
    }
    if (remote.status !== 'captured') {
      throw bookingError(HttpStatus.BAD_REQUEST, 'PAYMENT_NOT_CAPTURED', 'The payment was not completed. Please try again.');
    }
    await this.markPaid(payment.providerOrderId, { paymentId: remote.id, amountMinor: remote.amountMinor, currency: remote.currency, method: remote.method }, 'verify');
    return (await this.store.get(id)).status;
  }

  /**
   * Money arrived for one of our orders. Idempotent and safe to call concurrently (booking row lock):
   * - booking PENDING_PAYMENT, nothing captured yet → payment CAPTURED, booking PAID, ticketing queued
   * - booking EXPIRED/FAILED/CANCELLED, or a second captured payment → recorded, then refunded in full
   *   (EXPIRED/FAILED move to REFUND_PENDING; other bookings keep their status)
   */
  async markPaid(orderId: string, paid: PaidPayment, source: 'verify' | 'webhook' | 'reconcile'): Promise<MarkPaidOutcome> {
    const payment = await this.store.prisma.payment.findUnique({ where: { providerOrderId: orderId } });
    if (!payment) {
      this.logger.warn(`markPaid: unknown order source=${source}`);
      return 'UNKNOWN_ORDER';
    }
    if (!this.sameAmount(payment, paid)) {
      this.logger.error(`markPaid: amount/currency mismatch booking=${payment.bookingId} payment=${payment.id} source=${source}`);
      return 'MISMATCH';
    }

    const result = await this.store.prisma.$transaction(async (tx) => {
      const status = await this.store.lockStatus(tx, payment.bookingId);
      const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (SETTLED.includes(current.status)) return { outcome: 'ALREADY' as const };
      const otherCaptured = await tx.payment.count({ where: { bookingId: payment.bookingId, status: 'CAPTURED', id: { not: payment.id } } });
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'CAPTURED',
          providerPaymentId: paid.paymentId,
          ...(paid.method ? { method: paid.method } : {}),
          capturedAt: new Date(),
          failureCode: null,
          failureReason: null,
        },
      });

      if (status === 'PENDING_PAYMENT' && otherCaptured === 0) {
        await this.store.transition(payment.bookingId, 'PAID', 'SYSTEM', `Payment captured (${source})`, {
          tx,
          data: { paymentId: payment.id, provider: payment.provider, attempt: payment.attempt },
        });
        return { outcome: 'PAID' as const };
      }

      const reason: RefundReason = status === 'EXPIRED' || status === 'CANCELLED' ? 'LATE_PAYMENT' : status === 'FAILED' ? 'BOOKING_FAILED' : 'DUPLICATE_PAYMENT';
      const refundId = await this.refunds.initiate(tx, current, reason);
      if (status === 'EXPIRED' || status === 'FAILED') {
        await this.store.transition(payment.bookingId, 'REFUND_PENDING', 'SYSTEM', `Payment captured after the booking ended; full refund started (${source})`, {
          tx,
          data: { paymentId: payment.id, refundId, reason },
        });
      } else {
        await this.store.recordEvent(tx, payment.bookingId, status, 'SYSTEM', `Extra payment captured; full refund started (${source})`, {
          paymentId: payment.id,
          refundId,
          reason,
        });
      }
      return { outcome: 'REFUNDING' as const, refundId };
    }, TX_OPTIONS);

    if (result.outcome === 'PAID') {
      this.logger.log(`Booking paid booking=${payment.bookingId} source=${source}`);
      await this.jobs.ticket(payment.bookingId);
    } else if (result.outcome === 'REFUNDING') {
      await this.refunds.afterInitiated(payment.bookingId, result.refundId);
    }
    return result.outcome;
  }

  /** payment.failed: remember why the attempt failed (the customer may still retry or pay later). */
  async recordFailure(orderId: string, failed: { paymentId: string; errorCode: string | null; errorReason: string | null }): Promise<string> {
    const { count } = await this.store.prisma.payment.updateMany({
      where: { providerOrderId: orderId, status: { in: ['CREATED', 'AUTHORIZED'] } },
      data: { status: 'FAILED', failureCode: failed.errorCode?.slice(0, 64) ?? null, failureReason: failed.errorReason?.slice(0, 255) ?? null },
    });
    return count ? 'FAILED_RECORDED' : 'IGNORED';
  }

  /** Reconciliation: does a still-open attempt have money at the provider? */
  async reconcileOrder(payment: Payment): Promise<MarkPaidOutcome | 'OPEN'> {
    const items = await this.provider.fetchOrderPayments(payment.providerOrderId, { timeoutMs: PROVIDER_TIMEOUT_MS });
    let captured = items.find((p) => p.status === 'captured');
    const authorized = items.find((p) => p.status === 'authorized');
    if (!captured && authorized) captured = await this.provider.capture(authorized.id, authorized.amountMinor, authorized.currency, { timeoutMs: PROVIDER_TIMEOUT_MS });
    if (!captured || captured.status !== 'captured') return 'OPEN';
    return this.markPaid(payment.providerOrderId, { paymentId: captured.id, amountMinor: captured.amountMinor, currency: captured.currency, method: captured.method }, 'reconcile');
  }

  private sameAmount(payment: Pick<Payment, 'amount' | 'currency'>, remote: Pick<ProviderPayment, 'amountMinor' | 'currency'>): boolean {
    const digits = currencyDigits(payment.currency);
    return remote.currency === payment.currency && fromMinor(remote.amountMinor, digits) === payment.amount.toFixed(digits);
  }

  private requireRealProvider(): void {
    if (this.provider.name === 'demo') throw new NotFoundException();
  }

  private async providerCall<T>(operation: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof PaymentProviderError)) throw err;
      this.logger.error(`Payment provider ${operation} failed code=${err.code}: ${err.message}`);
      // An unknown/invalid payment id presented by the client is a verification failure; on our own
      // order creation every failure is the provider's.
      if (operation !== 'createOrder' && (err.code === 'NOT_FOUND' || err.code === 'BAD_REQUEST')) {
        throw bookingError(HttpStatus.BAD_REQUEST, 'PAYMENT_VERIFICATION_FAILED', 'The payment could not be verified.');
      }
      throw bookingError(
        err.code === 'TIMEOUT' ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.BAD_GATEWAY,
        'PAYMENT_PROVIDER_ERROR',
        'The payment service is not responding. Please try again.',
      );
    }
  }
}
