import type { WorkerHost } from '@nestjs/bullmq';
import type { Logger } from '@nestjs/common';
import type { QueueSettings } from './queue.constants.js';

/**
 * Processors are declared with `autorun: false`; this starts one only when workers are enabled
 * for this process (WORKERS_ENABLED). Production runs them in a separate worker process.
 */
export function startWorker(host: WorkerHost, settings: QueueSettings, logger: Logger): void {
  if (!settings.workersEnabled) return;
  host.worker.on('failed', (job, err) => logger.error(`Job failed queue=${host.worker.name} job=${job?.id ?? '?'}: ${err.message}`));
  host.worker.on('error', (err) => logger.error(`Worker error queue=${host.worker.name}: ${err.message}`));
  // run() resolves when the worker closes (app shutdown).
  host.worker.run().catch((err: Error) => logger.error(`Worker stopped queue=${host.worker.name}: ${err.message}`));
}
