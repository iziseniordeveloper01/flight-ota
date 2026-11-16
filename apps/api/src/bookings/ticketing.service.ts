import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BookingErrorCode } from '@ota/contracts';
import type { Prisma } from '@ota/db';
import { compareMoney, sumMoney, SupplierError, type CreateOrderInput, type Money, type OrderResult, type SupplierAdapter } from '@ota/suppliers';
import { Redis } from 'ioredis';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { withTimeout } from '../common/with-timeout.js';
import { FARE_GONE_MESSAGE, logSupplierError } from '../flights/supplier-errors.js';
import { SUPPLIER_ADAPTER } from '../flights/supplier.provider.js';
import { INSURANCE_PROVIDER, type InsuranceProvider } from '../insurance/insurance.provider.js';
import { PricingService } from '../pricing/pricing.service.js';
import { JobQueue } from '../queues/job-queue.service.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import { supplierTotals } from './booking-rules.js';
import { IllegalTransitionError } from './booking-state.js';
import { BookingStore, type BookingWithDetails } from './booking-store.service.js';
import { displayPriceOf, fxSnapshotOf, toMoney } from './booking-view.js';

// Duffel asks for ≥130s on order creation (airlines can take 120s). Never shorter: a premature
// abort leaves an order whose outcome we don't know.
const ORDER_TIMEOUT_MS = 130_000;
const RECOVERY_TIMEOUT_MS = 15_000;
// GET may be polled every few seconds while CONFIRMING; ask the supplier at most this often.
const RECOVERY_THROTTLE_SECONDS = 10;
const REDIS_TIMEOUT_MS = 200;
/** After a createOrder TIMEOUT: retrieveOrder checks at +1, +2, +5, +10, +20 minutes. */
export const RECOVER_DELAYS_MS = [1, 2, 5, 10, 20].map((m) => m * 60_000);

const recoveryKey = (id: string) => `bookings:recover:v1:${id}`;

/**
 * PAID → CONFIRMING → supplier createOrder → CONFIRMED | FAILED. Shared by the ticketing worker and
 * confirm-demo. The DB status decides everything: only a PAID booking is ever ordered (once — the
 * PAID→CONFIRMING transition is the lock), a CONFIRMING one is only ever recovered via
 * retrieveOrder, anything else is left alone. createOrder is never retried automatically.
 */
@Injectable()
export class TicketingService {
  private readonly logger = new Logger(TicketingService.name);

  constructor(
    private readonly store: BookingStore,
    private readonly crypto: FieldEncryptionService,
    private readonly pricing: PricingService,
    private readonly jobs: JobQueue,
    @Inject(SUPPLIER_ADAPTER) private readonly adapter: SupplierAdapter,
    @Inject(INSURANCE_PROVIDER) private readonly insurance: InsuranceProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async ticket(id: string): Promise<BookingWithDetails> {
    let booking = await this.store.get(id);
    if (booking.status === 'CONFIRMING') return this.recover(booking, { throttle: false });
    if (booking.status !== 'PAID') return booking;

    try {
      // Whoever wins this locked transition is the only caller that will ever order this booking.
      await this.store.transition(id, 'CONFIRMING', 'SYSTEM', 'Ticketing started');
    } catch (err) {
      if (!(err instanceof IllegalTransitionError)) throw err;
      return this.store.get(id); // another worker/request took it
    }
    booking = await this.store.get(id);

    if (booking.supplier !== this.adapter.name) {
      // SUPPLIER was switched since the booking was made: this adapter can't book it.
      await this.fail(booking, new SupplierError('OFFER_EXPIRED', this.adapter.name,'Booking belongs to another supplier'));
      return this.store.get(id);
    }

    let result: OrderResult;
    try {
      // No request AbortSignal on purpose: a client disconnect must never cancel a booking mid-flight.
      result = await this.adapter.createOrder(this.orderInput(booking), { timeoutMs: ORDER_TIMEOUT_MS });
    } catch (err) {
      // Not a SupplierError = our bug; the booking stays CONFIRMING and the stuck alert reports it.
      if (!(err instanceof SupplierError)) throw err;
      logSupplierError(this.logger, `createOrder booking=${id}`, err);
      if (err.code === 'TIMEOUT') {
        // The order may exist. Never re-create it: retrieveOrder checks settle it.
        await this.store.recordEvent(this.store.prisma, id, 'CONFIRMING', 'SYSTEM', 'Supplier timed out; outcome unknown');
        await this.jobs.recover(id, 1, RECOVER_DELAYS_MS[0]);
        return this.store.get(id);
      }
      await this.fail(booking, err);
      return this.store.get(id);
    }
    return this.settle(booking, result);
  }

  /** Scheduled retrieveOrder check after a timeout; schedules the next one while still unknown. */
  async recoverJob(id: string, attempt: number): Promise<void> {
    const booking = await this.store.get(id);
    if (booking.status !== 'CONFIRMING') return;
    const after = await this.recover(booking, { throttle: false });
    if (after.status === 'CONFIRMING' && attempt < RECOVER_DELAYS_MS.length) {
      await this.jobs.recover(id, attempt + 1, RECOVER_DELAYS_MS[attempt]);
    }
  }

  /** CONFIRMING after a lost/timed-out response: ask the supplier whether the order exists. */
  async recover(booking: BookingWithDetails, opts: { throttle: boolean }): Promise<BookingWithDetails> {
    if (booking.status !== 'CONFIRMING' || booking.supplier !== this.adapter.name) return booking;
    if (opts.throttle && !(await this.acquireRecoverySlot(booking.id))) return booking;
    const lead = booking.passengers[0];
    if (!lead) return booking;
    try {
      const result = await this.adapter.retrieveOrder(
        {
          supplierOrderId: booking.supplierOrderId ?? undefined,
          idempotencyKey: booking.id,
          leadPassenger: { givenName: lead.givenName, familyName: lead.familyName },
          expectedTotal: supplierTotal(booking),
        },
        { timeoutMs: RECOVERY_TIMEOUT_MS },
      );
      return result ? await this.settle(booking, result) : booking;
    } catch (err) {
      if (!(err instanceof SupplierError)) throw err;
      logSupplierError(this.logger, `retrieveOrder booking=${booking.id}`, err);
      return booking;
    }
  }

  private orderInput(booking: BookingWithDetails): CreateOrderInput {
    const refById = new Map(booking.passengers.map((p) => [p.id, p.supplierPassengerId]));
    return {
      supplierOfferId: booking.supplierOfferId,
      supplierRef: booking.supplierRef as Record<string, unknown>,
      passengers: booking.passengers.map((p) => ({
        ref: p.supplierPassengerId,
        type: lower(p.type),
        title: lower(p.title),
        gender: lower(p.gender),
        givenName: p.givenName,
        // null for mononyms: each adapter applies its own supplier's convention.
        familyName: p.familyName,
        dateOfBirth: this.crypto.decrypt(p.dateOfBirthEnc),
        nationality: p.nationality,
        ...(p.documentNumberEnc && p.documentIssuingCountry && p.documentExpiryDate
          ? {
              document: {
                type: 'passport' as const,
                number: this.crypto.decrypt(p.documentNumberEnc),
                issuingCountry: p.documentIssuingCountry,
                expiryDate: p.documentExpiryDate.toISOString().slice(0, 10),
              },
            }
          : {}),
        ...(p.infantAssociatedAdultId ? { associatedAdultRef: refById.get(p.infantAssociatedAdultId) } : {}),
      })),
      contact: { email: booking.contactEmail!, phone: booking.contactPhone! },
      services: booking.ancillaries
        .filter((a) => a.type !== 'INSURANCE')
        .map((a) => ({ serviceId: a.supplierServiceId!, quantity: a.quantity })),
      // In the SUPPLIER's currency: the airline checks its own price, never our INR amount.
      expectedTotal: supplierTotal(booking),
      // One order attempt per booking, so the booking id is the supplier-side idempotency key.
      idempotencyKey: booking.id,
    };
  }

  /** Apply an order result. Tolerates a concurrent settle (GET recovery vs. worker). */
  private async settle(booking: BookingWithDetails, result: OrderResult): Promise<BookingWithDetails> {
    if (result.status === 'pending') {
      if (booking.supplierOrderId !== result.supplierOrderId) {
        await this.store.update(booking.id, { supplierOrderId: result.supplierOrderId });
      }
      return this.store.get(booking.id);
    }
    const expected = supplierTotal(booking);
    if (result.total.currency !== expected.currency || compareMoney(result.total, expected) !== 0) {
      // Money has already moved: the booking is confirmed regardless; ops must reconcile.
      this.logger.error(`Order total differs from expected booking=${booking.id} reference=${booking.reference}`);
    }
    try {
      await this.store.transition(booking.id, 'CONFIRMED', 'SYSTEM', 'Order confirmed', {
        patch: { supplierOrderId: result.supplierOrderId, pnr: result.pnr, confirmedAt: new Date() },
        data: { supplierOrderId: result.supplierOrderId },
      });
    } catch (err) {
      if (!(err instanceof IllegalTransitionError)) throw err;
      const current = await this.store.get(booking.id);
      if (current.status === 'CONFIRMED') return current; // settled by a concurrent request
      throw err;
    }
    this.logger.log(`Booking confirmed id=${booking.id} reference=${booking.reference}`);
    await this.bindInsurance(booking);
    await this.jobs.email('booking-confirmed', booking.id);
    return this.store.get(booking.id);
  }

  private async bindInsurance(booking: BookingWithDetails): Promise<void> {
    const row = booking.ancillaries.find((a) => a.type === 'INSURANCE');
    if (!row?.supplierServiceId) return;
    try {
      const { policyNumber } = await this.insurance.bind(row.supplierServiceId, { reference: booking.reference });
      await this.store.update(booking.id, { insurancePolicyNumber: policyNumber });
      await this.store.recordEvent(this.store.prisma, booking.id, 'CONFIRMED', 'SYSTEM', 'Insurance bound', {
        provider: this.insurance.name,
      });
    } catch (err) {
      // The flight is booked; a missing policy is an ops follow-up, not a failed booking.
      this.logger.error(`Insurance bind failed booking=${booking.id}: ${(err as Error).message}`);
    }
  }

  /** CONFIRMING → FAILED, then the captured payment (if any) is refunded in full by the refunds job. */
  private async fail(booking: BookingWithDetails, err: SupplierError): Promise<void> {
    const { code, message } = failureOf(err);
    const data: Record<string, unknown> = { supplierCode: err.code };
    if (code === 'PRICE_CHANGED') {
      // What the customer would pay now (charge currency). Best effort: nothing here may throw
      // before the FAILED transition below.
      try {
        const current = displayPriceOf(booking);
        data.previousTotal = current.total;
        const fx = fxSnapshotOf(booking);
        if (err.newTotal && fx && err.newTotal.currency === fx.base) {
          const quote = this.pricing.fromSnapshot(fx);
          const fare = quote.fare(err.newTotal).charge;
          data.newTotal = sumMoney([fare, current.insurance], fare.currency);
        }
      } catch (e) {
        this.logger.warn(`PRICE_CHANGED totals unavailable booking=${booking.id}: ${(e as Error).message}`);
      }
    }
    await this.store.transition(booking.id, 'FAILED', 'SYSTEM', `Order failed: ${err.code}`, {
      patch: { failureCode: code, failureReason: message },
      data: data as Prisma.InputJsonValue,
    });
    if (booking.payments.some((p) => p.status === 'CAPTURED')) await this.jobs.refundBooking(booking.id);
  }

  // Redis SET NX as a per-booking rate limit; if Redis is down, recover anyway (fail open).
  private async acquireRecoverySlot(id: string): Promise<boolean> {
    if (this.redis.status !== 'ready') return true;
    try {
      const ok = await withTimeout(
        this.redis.set(recoveryKey(id), '1', 'EX', RECOVERY_THROTTLE_SECONDS, 'NX'),
        REDIS_TIMEOUT_MS,
        'recovery throttle',
      );
      return ok === 'OK';
    } catch {
      return true;
    }
  }
}

/** What the supplier charges: fare + bags/seats, in its currency (insurance is ours). */
export function supplierTotal(booking: BookingWithDetails): Money {
  return supplierTotals(toMoney(booking.fareAmount, booking.currency), [toMoney(booking.ancillariesAmount, booking.currency)]).total;
}

export function failureOf(err: SupplierError): { code: BookingErrorCode; message: string } {
  switch (err.code) {
    case 'PRICE_CHANGED':
      return { code: 'PRICE_CHANGED', message: 'The airline changed the price. Please start a new booking.' };
    case 'OFFER_EXPIRED':
    case 'OFFER_NOT_FOUND':
      // Includes Duffel's offer_request_already_booked: the customer must search again.
      return { code: 'FARE_NO_LONGER_AVAILABLE', message: FARE_GONE_MESSAGE };
    case 'INVALID_REQUEST':
      return { code: 'BOOKING_REJECTED', message: 'The airline rejected the booking details.' };
    default:
      return { code: 'SUPPLIER_ERROR', message: 'The airline could not confirm this booking.' };
  }
}

function lower<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>;
}
