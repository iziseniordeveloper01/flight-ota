import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Payment, Refund } from '@ota/db';
import { currencyDigits, toMinor } from '@ota/suppliers';
import { BookingStore, TX_OPTIONS, type Tx } from '../bookings/booking-store.service.js';
import { JobQueue } from '../queues/job-queue.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider, type ProviderRefundStatus } from './payment-provider.js';

export type RefundReason = 'BOOKING_FAILED' | 'LATE_PAYMENT' | 'DUPLICATE_PAYMENT';

const PROVIDER_TIMEOUT_MS = 15_000;

/**
 * Full refunds. The DB part (Refund row PENDING, payment REFUND_PENDING, booking REFUND_PENDING)
 * happens in one transaction; the provider call runs in the `refunds` queue (retried with backoff,
 * idempotency key = our refund id, so a retry can never refund twice). Completion arrives by
 * webhook (refund.processed / refund.failed) or the reconciliation job.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly store: BookingStore,
    private readonly jobs: JobQueue,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** Inside the caller's transaction (booking row already locked). Returns the refund id. */
  async initiate(tx: Tx, payment: Pick<Payment, 'id' | 'amount' | 'currency'>, reason: RefundReason): Promise<string> {
    const refund = await tx.refund.create({
      data: { paymentId: payment.id, amount: payment.amount, currency: payment.currency, reason },
      select: { id: true },
    });
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUND_PENDING' } });
    return refund.id;
  }

  /** After the provider accepted the money and the booking FAILED: refund it in full. Idempotent. */
  async refundFailedBooking(bookingId: string): Promise<string | null> {
    const refundId = await this.store.prisma.$transaction(async (tx) => {
      const status = await this.store.lockStatus(tx, bookingId);
      if (status !== 'FAILED') return null;
      const captured = await tx.payment.findFirst({ where: { bookingId, status: 'CAPTURED' } });
      if (!captured) return null; // demo flow, or already refunded
      const id = await this.initiate(tx, captured, 'BOOKING_FAILED');
      await this.store.transition(bookingId, 'REFUND_PENDING', 'SYSTEM', 'Full refund started (booking failed)', {
        tx,
        data: { refundId: id, reason: 'BOOKING_FAILED' },
      });
      return id;
    }, TX_OPTIONS);
    if (refundId) await this.afterInitiated(bookingId, refundId);
    return refundId;
  }

  /** Queue the provider call + the "refund initiated" email. */
  async afterInitiated(bookingId: string, refundId: string): Promise<void> {
    this.logger.log(`Refund initiated booking=${bookingId} refund=${refundId}`);
    await this.jobs.refundSend(refundId);
    await this.jobs.email('refund-initiated', bookingId, refundId);
  }

  /** Ask the provider to refund (job `refund-send`). Throws on provider errors → the job retries. */
  async send(refundId: string): Promise<void> {
    const refund = await this.store.prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
    if (!refund || refund.status !== 'PENDING' || refund.providerRefundId) return;
    if (!refund.payment.providerPaymentId) throw new Error(`Refund ${refundId}: payment has no provider id`);
    const result = await this.provider.refund(
      refund.payment.providerPaymentId,
      {
        amountMinor: toMinor(refund.amount.toFixed(currencyDigits(refund.currency)), currencyDigits(refund.currency)),
        idempotencyKey: refund.id,
        notes: { refundId: refund.id, bookingId: refund.payment.bookingId },
      },
      { timeoutMs: PROVIDER_TIMEOUT_MS },
    );
    await this.store.prisma.refund.updateMany({ where: { id: refund.id, providerRefundId: null }, data: { providerRefundId: result.id } });
    await this.apply(refund.id, result.status, 'provider');
  }

  /** refund.processed / refund.failed webhooks. The refund is matched by provider id, else by payment. */
  async applyFromWebhook(match: { providerRefundId: string | null; providerPaymentId: string | null }, status: ProviderRefundStatus): Promise<string> {
    let refund = match.providerRefundId ? await this.store.prisma.refund.findUnique({ where: { providerRefundId: match.providerRefundId } }) : null;
    if (!refund && match.providerPaymentId) {
      // Our provider call's response was lost: the only pending refund of that payment.
      refund = await this.store.prisma.refund.findFirst({
        where: { status: 'PENDING', providerRefundId: null, payment: { providerPaymentId: match.providerPaymentId } },
      });
      if (refund && match.providerRefundId) {
        await this.store.prisma.refund.update({ where: { id: refund.id }, data: { providerRefundId: match.providerRefundId } });
      }
    }
    if (!refund) return 'UNKNOWN_REFUND';
    return this.apply(refund.id, status, 'webhook');
  }

  /** Reconciliation: poll a pending refund (or re-queue the provider call if it never got through). */
  async refresh(refund: Refund): Promise<string> {
    if (!refund.providerRefundId) {
      await this.jobs.refundSend(refund.id);
      return 'REQUEUED';
    }
    const remote = await this.provider.fetchRefund(refund.providerRefundId, { timeoutMs: PROVIDER_TIMEOUT_MS });
    return this.apply(refund.id, remote.status, 'reconcile');
  }

  /** Idempotent: only a PENDING refund changes. processed → REFUNDED (booking too, once all are done). */
  private async apply(refundId: string, status: ProviderRefundStatus, source: string): Promise<string> {
    if (status === 'pending') return 'PENDING';
    const result = await this.store.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
      const bookingId = refund.payment.bookingId;
      const bookingStatus = await this.store.lockStatus(tx, bookingId);
      const current = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
      if (current.status !== 'PENDING') return { outcome: 'ALREADY', bookingId, completed: false };

      if (status === 'failed') {
        await tx.refund.update({ where: { id: refundId }, data: { status: 'FAILED' } });
        await tx.payment.update({ where: { id: refund.paymentId }, data: { status: 'REFUND_FAILED' } });
        await this.store.recordEvent(tx, bookingId, bookingStatus, 'SYSTEM', 'Refund failed at the provider', { refundId, source });
        return { outcome: 'REFUND_FAILED', bookingId, completed: false };
      }

      await tx.refund.update({ where: { id: refundId }, data: { status: 'PROCESSED' } });
      await tx.payment.update({ where: { id: refund.paymentId }, data: { status: 'REFUNDED' } });
      const stillPending = await tx.refund.count({ where: { status: 'PENDING', payment: { bookingId } } });
      if (bookingStatus === 'REFUND_PENDING' && stillPending === 0) {
        await this.store.transition(bookingId, 'REFUNDED', 'SYSTEM', 'Refund completed', { tx, data: { refundId, source } });
      } else {
        await this.store.recordEvent(tx, bookingId, bookingStatus, 'SYSTEM', 'Refund completed', { refundId, source });
      }
      return { outcome: 'REFUNDED', bookingId, completed: true };
    }, TX_OPTIONS);

    if (result.outcome === 'REFUND_FAILED') {
      // Money is stuck with us: a human must act (until the admin queue exists, this log is the alert).
      this.logger.error(`Refund FAILED at provider booking=${result.bookingId} refund=${refundId}`);
    }
    if (result.completed) await this.jobs.email('refund-completed', result.bookingId, refundId);
    return result.outcome;
  }
}
