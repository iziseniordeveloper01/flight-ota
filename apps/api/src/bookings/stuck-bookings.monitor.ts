import { Injectable, Logger } from '@nestjs/common';
import { BookingStore } from './booking-store.service.js';

export const STUCK_AFTER_MS = 15 * 60_000;

/**
 * Bookings stuck in CONFIRMING (supplier outcome unknown) need a human. Until the admin exception
 * queue exists, this logs a WARN (id + reference only, never PII) — on GET /bookings/:id and from
 * the 5-minute `maintenance` job (a BullMQ job scheduler: each tick runs on exactly one worker).
 */
@Injectable()
export class StuckBookingsMonitor {
  private readonly logger = new Logger(StuckBookingsMonitor.name);

  constructor(private readonly store: BookingStore) {}

  async sweep(): Promise<number> {
    const stuck = await this.store.inStatusSince('CONFIRMING', new Date(Date.now() - STUCK_AFTER_MS));
    for (const b of stuck) this.logger.warn(`Booking stuck in CONFIRMING id=${b.id} reference=${b.reference}`);
    return stuck.length;
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
