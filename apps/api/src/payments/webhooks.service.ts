import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { BookingStore, isUniqueViolation } from '../bookings/booking-store.service.js';
import { JobQueue } from '../queues/job-queue.service.js';
import { PaymentsService } from './payments.service.js';
import { RefundsService } from './refunds.service.js';

/** Events we act on; anything else is acknowledged and ignored. */
export const HANDLED_EVENTS = ['payment.captured', 'order.paid', 'payment.failed', 'refund.processed', 'refund.failed'] as const;

// Only ids, amount, status and error CODES are read. The entities also carry email/phone/card data,
// which is never parsed, logged or stored (no raw payload is kept).
const id = z.string().max(64);
const webhookSchema = z.object({
  event: z.string().max(64),
  payload: z
    .object({
      payment: z
        .object({
          entity: z.object({
            id,
            order_id: id.nullish(),
            amount: z.number().int().nonnegative(),
            currency: z.string().length(3),
            status: z.string().max(20),
            error_code: z.string().nullish(),
          }),
        })
        .optional(),
      refund: z.object({ entity: z.object({ id, payment_id: id, amount: z.number().int().nonnegative(), status: z.string().max(20) }) }).optional(),
      order: z.object({ entity: z.object({ id }) }).optional(),
    })
    .default({}),
});

export interface WebhookSummary {
  type: string;
  orderId: string | null;
  paymentId: string | null;
  refundId: string | null;
  amountMinor: bigint | null;
  currency: string | null;
  status: string | null;
  errorCode: string | null;
}

/** Signature already verified. null = not an event we can read. */
export function summarize(json: unknown): WebhookSummary | null {
  const parsed = webhookSchema.safeParse(json);
  if (!parsed.success) return null;
  const { event, payload } = parsed.data;
  const payment = payload.payment?.entity;
  const refund = payload.refund?.entity;
  const amount = refund?.amount ?? payment?.amount;
  return {
    type: event,
    orderId: payment?.order_id ?? payload.order?.entity.id ?? null,
    paymentId: refund?.payment_id ?? payment?.id ?? null,
    refundId: refund?.id ?? null,
    amountMinor: amount === undefined ? null : BigInt(amount),
    currency: payment?.currency ?? null,
    status: refund?.status ?? payment?.status ?? null,
    errorCode: payment?.error_code?.slice(0, 64) ?? null,
  };
}

/**
 * Razorpay webhooks: at-least-once, unordered. receive() dedupes by x-razorpay-event-id and queues
 * the work so the HTTP reply stays fast; process() runs in the payments-webhooks worker.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly store: BookingStore,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly jobs: JobQueue,
  ) {}

  async receive(provider: string, eventId: string, summary: WebhookSummary): Promise<{ duplicate: boolean }> {
    const handled = (HANDLED_EVENTS as readonly string[]).includes(summary.type);
    let duplicate = false;
    try {
      await this.store.prisma.webhookEvent.create({
        data: {
          provider,
          eventId,
          type: summary.type,
          orderId: summary.orderId,
          paymentId: summary.paymentId,
          refundId: summary.refundId,
          amountMinor: summary.amountMinor,
          currency: summary.currency,
          status: summary.status,
          errorCode: summary.errorCode,
          ...(handled ? {} : { processedAt: new Date(), outcome: 'IGNORED' }),
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      duplicate = true;
    }
    if (!handled) return { duplicate };
    if (duplicate) {
      const existing = await this.store.prisma.webhookEvent.findUnique({ where: { eventId }, select: { processedAt: true } });
      if (existing?.processedAt) return { duplicate };
    }
    // New, or a redelivery whose first enqueue was lost: (re-)queue. Same job id → never runs twice.
    await this.jobs.webhook(eventId);
    return { duplicate };
  }

  async process(eventId: string): Promise<string> {
    const ev = await this.store.prisma.webhookEvent.findUnique({ where: { eventId } });
    if (!ev || ev.processedAt) return 'ALREADY';
    let outcome: string;
    switch (ev.type) {
      case 'payment.captured':
      case 'order.paid':
        outcome =
          ev.orderId && ev.paymentId && ev.amountMinor !== null && ev.currency
            ? await this.payments.markPaid(ev.orderId, { paymentId: ev.paymentId, amountMinor: ev.amountMinor, currency: ev.currency, method: null }, 'webhook')
            : 'MISSING_IDS';
        break;
      case 'payment.failed':
        outcome = ev.orderId && ev.paymentId ? await this.payments.recordFailure(ev.orderId, { paymentId: ev.paymentId, errorCode: ev.errorCode, errorReason: null }) : 'MISSING_IDS';
        break;
      case 'refund.processed':
      case 'refund.failed':
        outcome = await this.refunds.applyFromWebhook(
          { providerRefundId: ev.refundId, providerPaymentId: ev.paymentId },
          ev.type === 'refund.processed' ? 'processed' : 'failed',
        );
        break;
      default:
        outcome = 'IGNORED';
    }
    await this.store.prisma.webhookEvent.update({ where: { eventId }, data: { processedAt: new Date(), outcome } });
    this.logger.log(`Webhook processed type=${ev.type} event=${eventId} outcome=${outcome}`);
    return outcome;
  }
}
