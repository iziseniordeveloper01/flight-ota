import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import { BookingStore } from './booking-store.service.js';

export const STUCK_AFTER_MS = 15 * 60_000;
const CHECK_INTERVAL_MS = 5 * 60_000;
// Shorter than the interval and never released: at most one instance runs each 5-minute window.
const LOCK_KEY = 'bookings:lock:stuck-check';
const LOCK_TTL_SECONDS = 4 * 60;

/**
 * Bookings stuck in CONFIRMING (supplier outcome unknown) need a human. Until the admin exception
 * queue exists, this logs a WARN (id + reference only, never PII) — on GET /bookings/:id and on a
 * 5-minute sweep guarded by a Redis lock so only one API instance sweeps.
 */
@Injectable()
export class StuckBookingsMonitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(StuckBookingsMonitor.name);
  private readonly instanceId = randomUUID();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly store: BookingStore,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    // unref: the sweep never keeps the process alive on shutdown.
    this.timer = setInterval(() => void this.sweep(), CHECK_INTERVAL_MS).unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** One sweep if this instance wins the lock. Never throws (it runs from a timer). */
  async sweep(): Promise<void> {
    try {
      if (this.redis.status !== 'ready') return; // without the lock every instance would sweep
      const won = await withTimeout(
        this.redis.set(LOCK_KEY, this.instanceId, 'EX', LOCK_TTL_SECONDS, 'NX'),
        200,
        'stuck-check lock',
      );
      if (won !== 'OK') return;
      const stuck = await this.store.stuckConfirming(new Date(Date.now() - STUCK_AFTER_MS));
      for (const b of stuck) this.logger.warn(`Booking stuck in CONFIRMING id=${b.id} reference=${b.reference}`);
    } catch (err) {
      this.logger.error(`Stuck-booking sweep failed: ${(err as Error).message}`);
    }
  }

  async warnIfStuck(booking: { id: string; reference: string; status: string }): Promise<void> {
    if (booking.status !== 'CONFIRMING') return;
    try {
      const since = await this.store.enteredStatusAt(booking.id, 'CONFIRMING');
      if (since && Date.now() - since.getTime() > STUCK_AFTER_MS) {
        this.logger.warn(
          `Booking stuck in CONFIRMING id=${booking.id} reference=${booking.reference} since=${since.toISOString()}`,
        );
      }
    } catch (err) {
      this.logger.error(`Stuck-booking check failed: ${(err as Error).message}`);
    }
  }
}
