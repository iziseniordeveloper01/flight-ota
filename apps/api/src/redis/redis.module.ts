import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { JsonCacheService } from './json-cache.service.js';
import { REDIS_CLIENT } from './redis.constants.js';

export { REDIS_CLIENT };

// ioredis emits 'error' on every reconnect attempt (several per second while Redis is down),
// so we log at most once per window to keep logs readable.
const ERROR_LOG_INTERVAL_MS = 10_000;

function createRedisClient(config: ConfigService): Redis {
  const logger = new Logger('Redis');
  const client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
    // Required by BullMQ workers (Step 7); harmless for normal commands.
    maxRetriesPerRequest: null,
  });

  let lastErrorLogAt = 0;
  // Without an 'error' listener ioredis prints "Unhandled error event" for every failed attempt.
  client.on('error', (err: Error) => {
    const now = Date.now();
    if (now - lastErrorLogAt < ERROR_LOG_INTERVAL_MS) return;
    lastErrorLogAt = now;
    // 'localhost' resolves to ::1 and 127.0.0.1, so Node may raise an AggregateError with an
    // empty message; fall back to its code (e.g. ECONNREFUSED) so the log is still useful.
    const reason = err.message || (err as NodeJS.ErrnoException).code || err.name;
    logger.error(`Connection error: ${reason}`);
  });
  client.on('ready', () => logger.log('Connected'));

  return client;
}

// @Global: one shared Redis connection for the whole app (cache, TBO token, BullMQ later)
// instead of every module opening its own connection. JsonCacheService wraps it for caching.
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: createRedisClient,
    },
    JsonCacheService,
  ],
  exports: [REDIS_CLIENT, JsonCacheService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // Close the connection cleanly on shutdown so deploys don't leave hanging sockets.
  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') {
      // Graceful: lets in-flight commands finish before closing.
      await this.redis.quit();
    } else {
      // quit() is queued until the connection is ready, so it would hang forever when Redis is down.
      this.redis.disconnect();
    }
  }
}
