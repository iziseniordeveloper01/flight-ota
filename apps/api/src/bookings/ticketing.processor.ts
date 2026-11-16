import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE, QUEUE_SETTINGS, type QueueSettings, type RecoverJob, type TicketJob } from '../queues/queue.constants.js';
import { startWorker } from '../queues/start-worker.js';
import { TicketingService } from './ticketing.service.js';

// createOrder may take ~130s; a few in parallel. lockDuration > a typical order so a busy job is
// not declared stalled (a stalled re-run is still safe: the booking is CONFIRMING → recover only).
@Processor(QUEUE.ticketing, { autorun: false, concurrency: 5, lockDuration: 180_000 })
export class TicketingProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(TicketingProcessor.name);

  constructor(
    private readonly ticketing: TicketingService,
    @Inject(QUEUE_SETTINGS) private readonly settings: QueueSettings,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    startWorker(this, this.settings, this.logger);
  }

  async process(job: Job): Promise<string> {
    switch (job.name) {
      case 'ticket': {
        const { bookingId } = job.data as TicketJob;
        return (await this.ticketing.ticket(bookingId)).status;
      }
      case 'recover': {
        const { bookingId, attempt } = job.data as RecoverJob;
        await this.ticketing.recoverJob(bookingId, attempt);
        return 'recovered';
      }
      default:
        throw new Error(`Unknown ticketing job ${job.name}`);
    }
  }
}
