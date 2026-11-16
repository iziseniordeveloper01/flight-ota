import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { JobQueue } from './job-queue.service.js';
import { QUEUE, QUEUE_SETTINGS, type QueueSettings } from './queue.constants.js';

/** BullMQ wants host/port options (its own connections, maxRetriesPerRequest: null for workers). */
export function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: Number(u.pathname.slice(1) || 0),
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

// Separate global module so tests can override QUEUE_SETTINGS (own prefix, workers on/off).
@Global()
@Module({
  providers: [
    {
      provide: QUEUE_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): QueueSettings => ({
        prefix: config.get('QUEUE_PREFIX', { infer: true }),
        workersEnabled: config.get('WORKERS_ENABLED', { infer: true }),
      }),
    },
  ],
  exports: [QUEUE_SETTINGS],
})
export class QueueSettingsModule {}

/**
 * All queues (same Redis as the cache, own connections). Workers live with their feature modules
 * and only start when QUEUE_SETTINGS.workersEnabled (WORKERS_ENABLED) is true.
 */
@Global()
@Module({
  imports: [
    QueueSettingsModule,
    BullModule.forRootAsync({
      inject: [ConfigService, QUEUE_SETTINGS],
      useFactory: (config: ConfigService<Env, true>, settings: QueueSettings) => ({
        connection: redisConnection(config.get('REDIS_URL', { infer: true })),
        prefix: settings.prefix,
      }),
    }),
    BullModule.registerQueue(...Object.values(QUEUE).map((name) => ({ name }))),
  ],
  providers: [JobQueue],
  exports: [BullModule, JobQueue, QueueSettingsModule],
})
export class QueuesModule {}
