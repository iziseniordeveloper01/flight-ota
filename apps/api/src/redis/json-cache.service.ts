import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';
import { REDIS_CLIENT } from './redis.constants.js';

// Fast fail: a slow cache must never make a request slower than skipping it.
const CACHE_TIMEOUT_MS = 200;
// Records the caller can't do without (getRequired) get more patience: a slow Redis there is an
// outage to report, not a miss to paper over.
const REQUIRED_TIMEOUT_MS = 1_000;

export interface CacheEntry {
  key: string;
  value: unknown;
  ttlSeconds: number;
}

/**
 * JSON cache on the shared Redis client. It is an optimisation only: every failure (Redis down,
 * slow, bad JSON) is logged and reported as a miss / skipped write, never thrown.
 */
@Injectable()
export class JsonCacheService {
  private readonly logger = new Logger(JsonCacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // maxRetriesPerRequest: null queues commands while disconnected, so check status instead of waiting.
  get isReady(): boolean {
    return this.redis.status === 'ready';
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.isReady) return null;
    try {
      const raw = await withTimeout(this.redis.get(key), CACHE_TIMEOUT_MS, 'cache get');
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.logger.warn(`Cache read failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * For data that only lives in Redis (e.g. the offer a customer saw): null ONLY when the key is
   * missing; Redis down, slow or bad JSON throws, so callers never mistake an outage for "gone".
   */
  async getRequired<T>(key: string): Promise<T | null> {
    const raw = await withTimeout(this.redis.get(key), REQUIRED_TIMEOUT_MS, 'cache get');
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.setMany([{ key, value, ttlSeconds }]);
  }

  /** One round trip for many keys (e.g. every offer of a search result). */
  async setMany(entries: CacheEntry[]): Promise<void> {
    if (!this.isReady || entries.length === 0) return;
    try {
      const pipeline = this.redis.pipeline();
      for (const { key, value, ttlSeconds } of entries) {
        pipeline.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      }
      // exec() resolves with per-command errors instead of rejecting; surface the first one.
      const results = await withTimeout(pipeline.exec(), CACHE_TIMEOUT_MS, 'cache set');
      const failed = results?.find(([err]) => err);
      if (failed) throw failed[0];
    } catch (err) {
      this.logger.warn(`Cache write failed: ${(err as Error).message}`);
    }
  }
}
