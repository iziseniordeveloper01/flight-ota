import { Inject, Injectable, Logger } from '@nestjs/common';
import { BookingStore } from '../bookings/booking-store.service.js';
import { JobQueue } from '../queues/job-queue.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.js';
import { PaymentsService } from './payments.service.js';
import { RefundsService } from './refunds.service.js';

/** Open payment attempts are checked with the provider for this long. */
export const RECONCILE_MAX_AGE_MS = 3 * 24 * 60 * 60_000;
/** A PAID booking not picked up by ticketing within this time is re-enqueued. */
export const PAID_GRACE_MS = 2 * 60_000;
const BATCH = 50;

export interface ReconcileSummary {
  ordersChecked: number;
  paid: number;
  refundsChecked: number;
  ticketingRequeued: number;
  refundsStarted: number;
}

/**
 * Every 5 minutes (maintenance queue). Webhooks can't reach localhost and may be lost anywhere,
 * so the DB is reconciled against the provider: open attempts (money that arrived without a
 * verify/webhook), pending refunds, PAID bookings whose ticketing job was lost, FAILED bookings
 * whose refund was never started.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly store: BookingStore,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly jobs: JobQueue,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async reconcile(now = new Date()): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = { ordersChecked: 0, paid: 0, refundsChecked: 0, ticketingRequeued: 0, refundsStarted: 0 };
    const prisma = this.store.prisma;

    if (this.provider.name !== 'demo') {
      const open = await prisma.payment.findMany({
        where: { provider: this.provider.name, status: { in: ['CREATED', 'AUTHORIZED'] }, createdAt: { gt: new Date(now.getTime() - RECONCILE_MAX_AGE_MS) } },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
      });
      for (const payment of open) {
        summary.ordersChecked++;
        try {
          const outcome = await this.payments.reconcileOrder(payment);
          if (outcome === 'PAID' || outcome === 'REFUNDING') summary.paid++;
        } catch (err) {
          this.logger.warn(`Reconcile order failed payment=${payment.id}: ${(err as Error).message}`);
        }
      }

      const pending = await prisma.refund.findMany({ where: { status: 'PENDING', payment: { provider: this.provider.name } }, orderBy: { createdAt: 'asc' }, take: BATCH });
      for (const refund of pending) {
        summary.refundsChecked++;
        try {
          await this.refunds.refresh(refund);
        } catch (err) {
          this.logger.warn(`Reconcile refund failed refund=${refund.id}: ${(err as Error).message}`);
        }
      }
    }

    // Ticketing jobs lost (Redis hiccup) or failed before the booking left PAID. JobQueue.ticket()
    // removes a retained completed/failed job with the same id, so this really re-adds it.
    for (const b of await this.store.inStatusSince('PAID', new Date(now.getTime() - PAID_GRACE_MS), BATCH)) {
      if (await this.jobs.ticket(b.id)) summary.ticketingRequeued++;
    }
    for (const b of await this.store.failedWithCapturedPayment(BATCH)) {
      if (await this.jobs.refundBooking(b.id)) summary.refundsStarted++;
    }

    if (summary.ordersChecked || summary.refundsChecked || summary.ticketingRequeued || summary.refundsStarted) {
      this.logger.log(`Reconciliation ${JSON.stringify(summary)}`);
    }
    return summary;
  }
}
