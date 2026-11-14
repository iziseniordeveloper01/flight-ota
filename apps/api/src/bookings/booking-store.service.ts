import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type BookingActor, type BookingStatus, type PrismaClient } from '@ota/db';
import { withTimeout } from '../common/with-timeout.js';
import { PRISMA } from '../prisma/prisma.module.js';
import { assertTransition } from './booking-state.js';

const DB_TIMEOUT_MS = 3_000;
// Prisma aborts (rolls back) an interactive transaction after `timeout` — a real cancel,
// unlike withTimeout, which only stops waiting.
export const TX_OPTIONS = { maxWait: 2_000, timeout: 5_000 } as const;

export const BOOKING_DETAILS = {
  passengers: { orderBy: { position: 'asc' } },
  // UUID v7 ids are time-ordered: insertion order.
  ancillaries: { orderBy: { id: 'asc' } },
} satisfies Prisma.BookingInclude;

export type BookingWithDetails = Prisma.BookingGetPayload<{ include: typeof BOOKING_DETAILS }>;
export type Tx = Prisma.TransactionClient;

export interface TransitionOptions {
  /** Extra columns written in the same UPDATE as the status (pnr, failureCode, …). */
  patch?: Omit<Prisma.BookingUpdateInput, 'status'>;
  /** Event payload — never PII. */
  data?: Prisma.InputJsonValue;
  /** Join an outer transaction instead of opening one. */
  tx?: Tx;
}

/** Persistence for bookings: the single place that changes `status`. */
@Injectable()
export class BookingStore {
  constructor(@Inject(PRISMA) readonly prisma: PrismaClient) {}

  find(id: string): Promise<BookingWithDetails | null> {
    return withTimeout(
      this.prisma.booking.findUnique({ where: { id }, include: BOOKING_DETAILS }),
      DB_TIMEOUT_MS,
      'booking find',
    );
  }

  async get(id: string): Promise<BookingWithDetails> {
    const booking = await this.find(id);
    if (!booking) throw new Error(`Booking ${id} vanished`);
    return booking;
  }

  /** SELECT … FOR UPDATE: serializes every writer of this booking until the transaction ends. */
  async lockStatus(tx: Tx, id: string): Promise<BookingStatus> {
    const rows = await tx.$queryRaw<Array<{ status: BookingStatus }>>`
      SELECT status FROM bookings WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw new Error(`Booking ${id} not found`);
    return rows[0].status;
  }

  /**
   * The ONLY way to change a booking's status. Locks the row, checks the move against the state
   * machine (IllegalTransitionError otherwise), updates, and appends a BookingEvent — atomically.
   */
  async transition(
    id: string,
    to: BookingStatus,
    actor: BookingActor,
    message: string,
    opts: TransitionOptions = {},
  ): Promise<BookingStatus> {
    const run = async (tx: Tx) => {
      const from = await this.lockStatus(tx, id);
      assertTransition(from, to);
      await tx.booking.update({ where: { id }, data: { ...opts.patch, status: to } });
      await tx.bookingEvent.create({
        data: { bookingId: id, fromStatus: from, toStatus: to, actor, message, data: opts.data },
      });
      return from;
    };
    return opts.tx ? run(opts.tx) : this.prisma.$transaction(run, TX_OPTIONS);
  }

  /** Audit entry without a status change (details updated, price refreshed, …). */
  recordEvent(
    tx: Tx | PrismaClient,
    id: string,
    status: BookingStatus,
    actor: BookingActor,
    message: string,
    data?: Prisma.InputJsonValue,
  ): Promise<unknown> {
    return tx.bookingEvent.create({ data: { bookingId: id, fromStatus: status, toStatus: status, actor, message, data } });
  }

  /** When the booking last entered `status` (from the event log). */
  async enteredStatusAt(id: string, status: BookingStatus): Promise<Date | null> {
    const event = await withTimeout(
      this.prisma.bookingEvent.findFirst({
        where: { bookingId: id, toStatus: status, fromStatus: { not: status } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      DB_TIMEOUT_MS,
      'booking event find',
    );
    return event?.createdAt ?? null;
  }

  async lastEventData(id: string, status: BookingStatus): Promise<Record<string, unknown> | null> {
    const event = await withTimeout(
      this.prisma.bookingEvent.findFirst({
        where: { bookingId: id, toStatus: status },
        orderBy: { createdAt: 'desc' },
        select: { data: true },
      }),
      DB_TIMEOUT_MS,
      'booking event find',
    );
    return (event?.data as Record<string, unknown> | null) ?? null;
  }

  /** Bookings that entered CONFIRMING before `cutoff` and are still there (ids + references only). */
  stuckConfirming(cutoff: Date): Promise<Array<{ id: string; reference: string }>> {
    return withTimeout(
      this.prisma.booking.findMany({
        where: { status: 'CONFIRMING', events: { some: { toStatus: 'CONFIRMING', createdAt: { lt: cutoff } } } },
        select: { id: true, reference: true },
        take: 100,
      }),
      DB_TIMEOUT_MS,
      'stuck bookings query',
    );
  }

  /** Single-row update outside a status change (e.g. a pending supplier order id). */
  update(id: string, data: Omit<Prisma.BookingUpdateInput, 'status'>): Promise<unknown> {
    return withTimeout(this.prisma.booking.update({ where: { id }, data }), DB_TIMEOUT_MS, 'booking update');
  }

  isInternational(iataCodes: string[]): Promise<boolean> {
    const codes = [...new Set(iataCodes)];
    return withTimeout(
      this.prisma.airport
        .findMany({ where: { iataCode: { in: codes } }, select: { countryCode: true } })
        // An airport we don't know counts as international: asking for a passport is the safe side.
        .then((rows) => rows.length < codes.length || new Set(rows.map((r) => r.countryCode)).size > 1),
      DB_TIMEOUT_MS,
      'airport countries',
    );
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
