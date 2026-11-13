import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

type CheckStatus = 'up' | 'down';

@Controller('health')
export class HealthController {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // Used by AWS load balancer + uptime monitors: 200 = healthy, 503 = take this instance out.
  @Get()
  async check() {
    const startedAt = Date.now();
    const checks: Record<string, CheckStatus> = {
      redis: await this.pingRedis(),
      // TODO (Step 3): add database check via Prisma
    };

    const healthy = Object.values(checks).every((s) => s === 'up');
    const body = {
      status: healthy ? 'ok' : 'degraded',
      checks,
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - startedAt,
    };

    if (!healthy) throw new ServiceUnavailableException(body);
    return body;
  }

  private async pingRedis(): Promise<CheckStatus> {
    // With maxRetriesPerRequest: null, commands sent while disconnected are queued
    // indefinitely, so a ping would hang instead of failing. Answer from the status instead.
    if (this.redis.status !== 'ready') return 'down';

    try {
      // Guards against a half-open connection where 'ready' is stale but replies never come.
      const reply = await withTimeout(this.redis.ping(), 1000, 'redis ping');
      return reply === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}