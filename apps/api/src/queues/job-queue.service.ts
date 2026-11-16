import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';
import { withTimeout } from '../common/with-timeout.js';
import {
  QUEUE,
  type EmailJob,
  type EmailKind,
  type RecoverJob,
  type RefundBookingJob,
  type RefundSendJob,
  type TicketJob,
  type WebhookJob,
} from './queue.constants.js';

const ENQUEUE_TIMEOUT_MS = 2_000;
const DAY_SECONDS = 24 * 60 * 60;
// Explicit retention on every job: completed jobs are kept a day (dedupe by jobId), failed ones a
// week (inspection). A retained job blocks add() with the same jobId — see addFresh().
const RETENTION = {
  removeOnComplete: { age: DAY_SECONDS, count: 10_000 },
  removeOnFail: { age: 7 * DAY_SECONDS, count: 10_000 },
} satisfies JobsOptions;
const RETRY = { attempts: 5, backoff: { type: 'exponential', delay: 10_000 } } satisfies JobsOptions;

/**
 * The only place jobs are added: job ids, retries and retention are decided here. Callers treat a
 * failed enqueue as non-fatal — the DB is the source of truth and the reconciliation job re-enqueues
 * whatever a lost enqueue left behind. Custom job ids never contain ":" (BullMQ rejects it).
 */
@Injectable()
export class JobQueue {
  private readonly logger = new Logger(JobQueue.name);

  constructor(
    @InjectQueue(QUEUE.ticketing) readonly ticketing: Queue,
    @InjectQueue(QUEUE.paymentsWebhooks) readonly webhooks: Queue,
    @InjectQueue(QUEUE.refunds) readonly refunds: Queue,
    @InjectQueue(QUEUE.emails) readonly emails: Queue,
    @InjectQueue(QUEUE.maintenance) readonly maintenance: Queue,
  ) {}

  /** Book with the supplier. jobId = booking id; createOrder is never retried automatically. */
  ticket(bookingId: string): Promise<boolean> {
    return this.addFresh(this.ticketing, 'ticket', { bookingId } satisfies TicketJob, bookingId, { attempts: 1 });
  }

  /** retrieveOrder check for a booking whose createOrder timed out. */
  recover(bookingId: string, attempt: number, delayMs: number): Promise<boolean> {
    return this.add(this.ticketing, 'recover', { bookingId, attempt } satisfies RecoverJob, `recover-${bookingId}-${attempt}`, {
      attempts: 1,
      delay: delayMs,
    });
  }

  webhook(eventId: string): Promise<boolean> {
    return this.addFresh(this.webhooks, 'event', { eventId } satisfies WebhookJob, `wh-${safeId(eventId)}`, RETRY);
  }

  /** Refund the captured payment of a FAILED booking (no-op when there is none, e.g. demo). */
  refundBooking(bookingId: string): Promise<boolean> {
    return this.addFresh(this.refunds, 'refund-booking', { bookingId } satisfies RefundBookingJob, `refund-booking-${bookingId}`, RETRY);
  }

  /** Send a PENDING refund to the provider (idempotency key = refund id, so retries are safe). */
  refundSend(refundId: string): Promise<boolean> {
    return this.addFresh(this.refunds, 'refund-send', { refundId } satisfies RefundSendJob, `refund-send-${refundId}`, RETRY);
  }

  /** One email per (kind, booking/refund): a retained completed job blocks a duplicate send. */
  email(kind: EmailKind, bookingId: string, refundId?: string): Promise<boolean> {
    const data: EmailJob = { kind, bookingId, ...(refundId ? { refundId } : {}) };
    return this.add(this.emails, kind, data, `email-${kind}-${refundId ?? bookingId}`, RETRY);
  }

  /**
   * Add, replacing a finished job with the same id. BullMQ silently ignores add() while a job with
   * that id still exists — including completed/failed jobs kept by the retention settings — so a
   * re-enqueue would otherwise be a no-op. A waiting/active/delayed job is left alone (it will run).
   */
  private async addFresh(queue: Queue, name: string, data: object, jobId: string, opts: JobsOptions): Promise<boolean> {
    return this.guard(queue.name, jobId, async () => {
      const existing = await queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state !== 'completed' && state !== 'failed') return;
        await existing.remove();
      }
      await queue.add(name, data, { ...RETENTION, ...opts, jobId });
    });
  }

  private add(queue: Queue, name: string, data: object, jobId: string, opts: JobsOptions): Promise<boolean> {
    return this.guard(queue.name, jobId, () => queue.add(name, data, { ...RETENTION, ...opts, jobId }));
  }

  // Never throws: false = not enqueued (logged; reconciliation will catch up).
  private async guard(queueName: string, jobId: string, run: () => Promise<unknown>): Promise<boolean> {
    try {
      await withTimeout(run(), ENQUEUE_TIMEOUT_MS, `enqueue ${queueName}`);
      return true;
    } catch (err) {
      this.logger.error(`Enqueue failed queue=${queueName} job=${jobId}: ${(err as Error).message}`);
      return false;
    }
  }
}

/** Provider ids are [A-Za-z0-9_]; anything else is replaced so the job id stays valid. */
function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}
