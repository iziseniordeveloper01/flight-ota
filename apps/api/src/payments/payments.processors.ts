import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'bullmq';
import { StuckBookingsMonitor } from '../bookings/stuck-bookings.monitor.js';
import { JobQueue } from '../queues/job-queue.service.js';
import { QUEUE, QUEUE_SETTINGS, type QueueSettings, type RefundBookingJob, type RefundSendJob, type WebhookJob } from '../queues/queue.constants.js';
import { startWorker } from '../queues/start-worker.js';
import { ReconciliationService } from './reconciliation.service.js';
import { RefundsService } from './refunds.service.js';
import { WebhooksService } from './webhooks.service.js';

const EVERY_5_MIN = 5 * 60_000;

@Processor(QUEUE.paymentsWebhooks, { autorun: false, concurrency: 5 })
export class WebhooksProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(WebhooksProcessor.name);

  constructor(
    private readonly webhooks: WebhooksService,
    @Inject(QUEUE_SETTINGS) private readonly settings: QueueSettings,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    startWorker(this, this.settings, this.logger);
  }

  process(job: Job<WebhookJob>): Promise<string> {
    return this.webhooks.process(job.data.eventId);
  }
}

@Processor(QUEUE.refunds, { autorun: false, concurrency: 5 })
export class RefundsProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(RefundsProcessor.name);

  constructor(
    private readonly refunds: RefundsService,
    @Inject(QUEUE_SETTINGS) private readonly settings: QueueSettings,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    startWorker(this, this.settings, this.logger);
  }

  async process(job: Job): Promise<string> {
    switch (job.name) {
      case 'refund-booking':
        return (await this.refunds.refundFailedBooking((job.data as RefundBookingJob).bookingId)) ?? 'NOTHING_TO_REFUND';
      case 'refund-send':
        await this.refunds.send((job.data as RefundSendJob).refundId);
        return 'SENT';
      default:
        throw new Error(`Unknown refunds job ${job.name}`);
    }
  }
}

/**
 * Repeatable jobs (BullMQ job schedulers: each tick is ONE job, run by exactly one worker across
 * all instances — no extra Redis lock needed).
 */
@Processor(QUEUE.maintenance, { autorun: false, concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly monitor: StuckBookingsMonitor,
    private readonly jobs: JobQueue,
    @Inject(QUEUE_SETTINGS) private readonly settings: QueueSettings,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.settings.workersEnabled) return;
    try {
      // Idempotent upserts: every instance may call them, the schedule exists once.
      await this.jobs.maintenance.upsertJobScheduler('reconcile-payments', { every: EVERY_5_MIN }, { name: 'reconcile-payments', opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } } });
      await this.jobs.maintenance.upsertJobScheduler('stuck-bookings', { every: EVERY_5_MIN }, { name: 'stuck-bookings', opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } } });
    } catch (err) {
      this.logger.error(`Could not register maintenance schedules: ${(err as Error).message}`);
    }
    startWorker(this, this.settings, this.logger);
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'reconcile-payments':
        return this.reconciliation.reconcile();
      case 'stuck-bookings':
        return this.monitor.sweep();
      default:
        throw new Error(`Unknown maintenance job ${job.name}`);
    }
  }
}
