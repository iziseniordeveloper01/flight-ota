import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadGatewayException, GoneException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  lastFlightDate,
  type BookingAirport,
  type BookingErrorCode,
  type BookingIssue,
  type BookingWarning,
  type InsuranceQuote,
  type PublicAncillaries,
  type PublicBooking,
  type PublicFlightOffer,
  type UpdateBookingDetailsBody,
} from '@ota/contracts';
import type { AncillaryType, BookingStatus, Prisma } from '@ota/db';
import {
  compareMoney,
  multiplyMoney,
  SupplierError,
  type Ancillaries,
  type CreateOrderInput,
  type Money,
  type OfferPassenger,
  type OrderResult,
  type PricedOffer,
  type SeatMap,
  type SupplierAdapter,
} from '@ota/suppliers';
import { Redis } from 'ioredis';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { withTimeout } from '../common/with-timeout.js';
import { FlightsService } from '../flights/flights.service.js';
import { toPublicOffer } from '../flights/public-offer.js';
import { callSupplier, GONE_MESSAGE, logSupplierError } from '../flights/supplier-errors.js';
import { SUPPLIER_ADAPTER } from '../flights/supplier.provider.js';
import { INSURANCE_PROVIDER, type InsuranceProvider } from '../insurance/insurance.provider.js';
import { JsonCacheService } from '../redis/json-cache.service.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import { bookingError, bookingNotFound, rulesViolated } from './booking-errors.js';
import { withUniqueReference } from './booking-reference.js';
import {
  bookingTotals,
  buildCatalogue,
  checkPassengers,
  isInternationalTrip,
  itineraryAirports,
  priceServices,
  type CatalogueEntry,
  type RulesPassenger,
} from './booking-rules.js';
import { EXPIRABLE, IllegalTransitionError } from './booking-state.js';
import { BOOKING_DETAILS, BookingStore, isUniqueViolation, TX_OPTIONS, type BookingWithDetails, type Tx } from './booking-store.service.js';
import { toMoney, toPublicBooking } from './booking-view.js';
import { StuckBookingsMonitor } from './stuck-bookings.monitor.js';

const SUPPLIER_TIMEOUT_MS = 30_000;
// Duffel asks for ≥130s on order creation (airlines can take 120s). Never shorter: a premature
// abort leaves an order whose outcome we don't know.
const ORDER_TIMEOUT_MS = 130_000;
const RECOVERY_TIMEOUT_MS = 15_000;
// GET may be polled every few seconds while CONFIRMING; ask the supplier at most this often.
const RECOVERY_THROTTLE_SECONDS = 10;
const REDIS_TIMEOUT_MS = 200;

const ancillariesKey = (id: string) => `bookings:ancillaries:v1:${id}`;
const seatMapsKey = (id: string) => `bookings:seat-maps:v1:${id}`;
const recoveryKey = (id: string) => `bookings:recover:v1:${id}`;

export interface ConfirmResult {
  /** 200 settled, 202 still CONFIRMING. */
  httpStatus: HttpStatus.OK | HttpStatus.ACCEPTED;
  booking: PublicBooking;
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly store: BookingStore,
    private readonly flights: FlightsService,
    private readonly crypto: FieldEncryptionService,
    private readonly cache: JsonCacheService,
    private readonly monitor: StuckBookingsMonitor,
    @Inject(SUPPLIER_ADAPTER) private readonly adapter: SupplierAdapter,
    @Inject(INSURANCE_PROVIDER) private readonly insurance: InsuranceProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Create

  async create(offerId: string): Promise<{
    booking: PublicBooking;
    guestToken: string;
    priceChanged: boolean;
    previousTotal?: Money;
  }> {
    // Fresh re-price against what the customer saw in the results (410 when gone).
    const priced = await this.flights.getOffer(offerId);
    const total = priced.price.total;
    // Shown once, stored only as a hash: whoever holds it can manage this booking.
    const guestToken = randomBytes(32).toString('base64url');

    const booking = await withUniqueReference(
      (reference) =>
        this.store.prisma.$transaction(async (tx) => {
          const created = await tx.booking.create({
            data: {
              reference,
              supplier: priced.supplier,
              supplierOfferId: priced.supplierOfferId,
              offerSnapshot: snapshotOf(priced),
              supplierRef: priced.supplierRef as Prisma.InputJsonValue,
              currency: total.currency,
              fareAmount: total.amount,
              totalAmount: total.amount,
              guestTokenHash: sha256Hex(guestToken),
              offerExpiresAt: new Date(priced.expiresAt),
            },
            include: BOOKING_DETAILS,
          });
          await tx.bookingEvent.create({
            data: {
              bookingId: created.id,
              toStatus: 'DRAFT',
              actor: 'GUEST',
              message: 'Draft created',
              data: { priceChanged: priced.priceChanged },
            },
          });
          return created;
        }, TX_OPTIONS),
      isUniqueViolation,
    );
    this.logger.log(`Booking created id=${booking.id} reference=${booking.reference}`);
    return {
      booking: await this.view(booking),
      guestToken,
      priceChanged: priced.priceChanged,
      ...(priced.previousTotal ? { previousTotal: priced.previousTotal } : {}),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Read

  async get(id: string, token: string | undefined): Promise<PublicBooking> {
    let booking = await this.load(id, token);
    if (booking.status === 'CONFIRMING') {
      await this.monitor.warnIfStuck(booking);
      booking = await this.recover(booking);
    }
    return this.view(booking);
  }

  async ancillaries(id: string, token: string | undefined): Promise<PublicAncillaries> {
    const booking = await this.load(id, token);
    this.requireStatus(booking, 'DRAFT', 'PENDING_PAYMENT');
    const ancillaries = await this.fetchAncillaries(booking);
    return {
      ...ancillaries,
      passengerRequirements: {
        ...ancillaries.passengerRequirements,
        identityDocumentRequired: await this.documentRequired(booking, ancillaries),
      },
    };
  }

  async seatMaps(id: string, token: string | undefined): Promise<SeatMap[]> {
    const booking = await this.load(id, token);
    this.requireStatus(booking, 'DRAFT', 'PENDING_PAYMENT');
    return this.fetchSeatMaps(booking);
  }

  // ---------------------------------------------------------------------------------------------
  // Details

  async updateDetails(
    id: string,
    token: string | undefined,
    body: UpdateBookingDetailsBody,
  ): Promise<{ booking: PublicBooking; warnings: BookingWarning[] }> {
    const booking = await this.load(id, token);
    this.requireStatus(booking, 'DRAFT');
    const offer = offerOf(booking);

    const ancillaries = await this.fetchAncillaries(booking);
    // Seat maps only when something other than a bag was selected.
    const bagIds = new Set(ancillaries.bags.map((b) => b.serviceId));
    const seatMaps = body.services.some((s) => !bagIds.has(s.serviceId)) ? await this.fetchSeatMaps(booking) : null;

    const kept = keepStoredDocuments(body.passengers, booking);
    const { issues, warnings } = checkPassengers(kept.passengers, {
      slots: offer.passengers,
      lastFlightDate: lastFlightDate(offer),
      documentRequired: await this.documentRequired(booking, ancillaries),
      maxNameLength: ancillaries.passengerRequirements.maxNameLength,
    });
    const priced = priceServices(
      body.services,
      buildCatalogue(ancillaries, seatMaps),
      new Set(offer.passengers.map((p) => p.ref)),
    );
    // A missing stored passport is reported once (checkPassengers may flag the same path).
    const ruleIssues = issues.filter((i) => !kept.issues.some((k) => k.path === i.path));
    const allIssues: BookingIssue[] = [...kept.issues, ...ruleIssues, ...priced.issues];

    const fare = toMoney(booking.fareAmount, booking.currency);
    let quote: InsuranceQuote | undefined;
    if (body.insurance) {
      quote = (await this.insurance.quote({ fare }, offer.passengers)).find((q) => q.quoteId === body.insurance!.quoteId);
      if (!quote) {
        allIssues.push({ code: 'INSURANCE_QUOTE_INVALID', path: 'insurance.quoteId', message: 'This insurance plan is not available.' });
      }
    }
    if (allIssues.length) throw rulesViolated(allIssues);

    const totals = this.totalsOrBadGateway(fare, priced.lines.map((l) => l.amount), quote?.total ?? null);
    await this.store.prisma.$transaction(async (tx) => {
      const status = await this.store.lockStatus(tx, id);
      if (status !== 'DRAFT') throw illegalState(status);
      await tx.bookingAncillary.deleteMany({ where: { bookingId: id } });
      await tx.bookingPassenger.deleteMany({ where: { bookingId: id } });

      const idByRef = await this.insertPassengers(tx, id, offer.passengers, kept.passengers);
      await tx.bookingAncillary.createMany({
        data: [
          ...priced.lines.map((line) => ({
            bookingId: id,
            passengerId: idByRef.get(line.entry.passengerRef) ?? null,
            type: (line.entry.kind === 'bag' ? 'BAG' : 'SEAT') as AncillaryType,
            segmentRef: line.entry.segmentRef,
            supplierServiceId: line.entry.serviceId,
            label: line.label,
            quantity: line.quantity,
            amount: line.amount.amount,
            currency: line.amount.currency,
          })),
          ...(quote
            ? [{
                bookingId: id,
                type: 'INSURANCE' as const,
                supplierServiceId: quote.quoteId,
                label: quote.name,
                quantity: offer.passengers.length,
                amount: quote.total.amount,
                currency: quote.total.currency,
              }]
            : []),
        ],
      });
      const { contact } = body;
      await tx.booking.update({
        where: { id },
        data: {
          contactTitle: upper(contact.title),
          contactGivenName: contact.givenName,
          contactFamilyName: contact.familyName ?? null,
          contactEmail: contact.email,
          contactPhone: contact.phone,
          ancillariesAmount: totals.ancillaries.amount,
          insuranceAmount: totals.insurance.amount,
          totalAmount: totals.total.amount,
        },
      });
      await this.store.recordEvent(tx, id, 'DRAFT', 'GUEST', 'Details updated', {
        passengers: body.passengers.length,
        services: priced.lines.length,
        insurance: Boolean(quote),
      });
    }, TX_OPTIONS);
    return { booking: await this.view(await this.store.get(id)), warnings };
  }

  // Non-infants first so each infant can point at its adult's row; `position` keeps the slot order.
  private async insertPassengers(
    tx: Tx,
    bookingId: string,
    slots: OfferPassenger[],
    passengers: ResolvedPassenger[],
  ): Promise<Map<string, string>> {
    const byRef = new Map(passengers.map((p) => [p.ref, p]));
    const position = new Map(slots.map((s, i) => [s.ref, i]));
    const ordered = [...passengers].sort((a, b) => Number(a.type === 'infant') - Number(b.type === 'infant'));
    const idByRef = new Map<string, string>();
    for (const { ref } of ordered) {
      const p = byRef.get(ref)!;
      const { id } = await tx.bookingPassenger.create({
        data: {
          bookingId,
          position: position.get(ref)!,
          type: upper(p.type),
          title: upper(p.title),
          givenName: p.givenName,
          familyName: p.familyName ?? null,
          gender: upper(p.gender),
          dateOfBirthEnc: this.crypto.encrypt(p.dateOfBirth),
          nationality: p.nationality,
          documentType: p.document ? 'PASSPORT' : null,
          // A kept document is already encrypted: it is copied, never decrypted here.
          documentNumberEnc: p.document
            ? 'numberEnc' in p.document
              ? p.document.numberEnc
              : this.crypto.encrypt(p.document.number)
            : null,
          documentIssuingCountry: p.document?.issuingCountry ?? null,
          documentExpiryDate: p.document ? new Date(`${p.document.expiryDate}T00:00:00Z`) : null,
          infantAssociatedAdultId: p.associatedAdultRef ? (idByRef.get(p.associatedAdultRef) ?? null) : null,
          supplierPassengerId: ref,
        },
        select: { id: true },
      });
      idByRef.set(ref, id);
    }
    return idByRef;
  }

  // ---------------------------------------------------------------------------------------------
  // Checkout: fresh re-price of fare + add-ons, then DRAFT → PENDING_PAYMENT

  async checkout(id: string, token: string | undefined): Promise<PublicBooking> {
    const booking = await this.load(id, token);
    this.requireStatus(booking, 'DRAFT');
    const offer = offerOf(booking);
    if (!booking.contactEmail || booking.passengers.length !== offer.passengers.length) {
      throw bookingError(HttpStatus.UNPROCESSABLE_ENTITY, 'DETAILS_INCOMPLETE', 'Add passenger and contact details first.');
    }

    // Bypass every cache: this is the price the customer will pay (real payments in Step 8).
    const fresh = await this.supplierCall(booking, 'price', () =>
      this.adapter.price(booking.supplierOfferId, { timeoutMs: SUPPLIER_TIMEOUT_MS }),
    );
    const services = booking.ancillaries.filter((a) => a.type !== 'INSURANCE');
    const [ancillaries, seatMaps] = await Promise.all([
      services.some((a) => a.type === 'BAG') ? this.fetchAncillaries(booking, { fresh: true }) : null,
      services.some((a) => a.type === 'SEAT') ? this.fetchSeatMaps(booking, { fresh: true }) : null,
    ]);
    const catalogue = buildCatalogue(ancillaries, seatMaps);
    const unavailable = services
      .filter((a) => !fits(catalogue.get(a.supplierServiceId ?? ''), a.quantity))
      .map((a) => a.supplierServiceId ?? '');

    const fare = fresh.price.total;
    const insuranceRow = booking.ancillaries.find((a) => a.type === 'INSURANCE');
    const quote = insuranceRow
      ? (await this.insurance.quote({ fare }, offer.passengers)).find((q) => q.quoteId === insuranceRow.supplierServiceId)
      : undefined;
    if (insuranceRow && !quote) unavailable.push(insuranceRow.supplierServiceId ?? '');

    if (unavailable.length) {
      await this.store.recordEvent(this.store.prisma, id, 'DRAFT', 'SYSTEM', 'Add-ons no longer available at checkout', {
        serviceIds: unavailable,
      });
      throw bookingError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'SERVICE_UNAVAILABLE',
        'Some add-ons are no longer available. Please review your selection.',
        { serviceIds: unavailable },
      );
    }

    const lineAmounts = services.map((a) => ({
      id: a.id,
      amount: multiplyMoney(catalogue.get(a.supplierServiceId!)!.unitPrice, a.quantity),
    }));
    if (fare.currency !== booking.currency) {
      throw new BadGatewayException('The flight supplier changed the currency of this offer. Please search again.');
    }
    const totals = this.totalsOrBadGateway(fare, lineAmounts.map((l) => l.amount), quote?.total ?? null);
    const previousTotal = toMoney(booking.totalAmount, booking.currency);
    const changed = compareMoney(totals.total, previousTotal) !== 0;

    await this.store.prisma.$transaction(async (tx) => {
      const status = await this.store.lockStatus(tx, id);
      if (status !== 'DRAFT') throw illegalState(status);
      // Store the latest amounts either way: what we show is what the supplier just quoted.
      for (const line of lineAmounts) {
        await tx.bookingAncillary.update({ where: { id: line.id }, data: { amount: line.amount.amount } });
      }
      if (insuranceRow && quote) {
        await tx.bookingAncillary.update({ where: { id: insuranceRow.id }, data: { amount: quote.total.amount } });
      }
      const patch = {
        offerSnapshot: snapshotOf(fresh),
        supplierRef: fresh.supplierRef as Prisma.InputJsonValue,
        offerExpiresAt: new Date(fresh.expiresAt),
        fareAmount: totals.fare.amount,
        ancillariesAmount: totals.ancillaries.amount,
        insuranceAmount: totals.insurance.amount,
        totalAmount: totals.total.amount,
      };
      if (changed) {
        await tx.booking.update({ where: { id }, data: patch });
        await this.store.recordEvent(tx, id, 'DRAFT', 'SYSTEM', 'Price changed at checkout', {
          previousTotal: { ...previousTotal },
          newTotal: { ...totals.total },
        });
      } else {
        await this.store.transition(id, 'PENDING_PAYMENT', 'GUEST', 'Checkout', { patch, tx });
      }
    }, TX_OPTIONS);

    if (changed) {
      // Stays DRAFT: calling checkout again accepts the new price.
      throw bookingError(HttpStatus.UNPROCESSABLE_ENTITY, 'PRICE_CHANGED', 'The price has changed. Please review the new total.', {
        previousTotal,
        newTotal: totals.total,
      });
    }
    return this.view(await this.store.get(id));
  }

  // ---------------------------------------------------------------------------------------------
  // Demo confirmation: PENDING_PAYMENT → CONFIRMING → createOrder → CONFIRMED | FAILED

  async confirmDemo(id: string, token: string | undefined, idempotencyKey: string): Promise<ConfirmResult> {
    let booking = await this.load(id, token);
    if (booking.confirmIdempotencyKey) return this.replayConfirm(booking, idempotencyKey);
    this.requireStatus(booking, 'PENDING_PAYMENT');
    this.assertSupplier(booking);

    try {
      // The key is stored in the same locked UPDATE: whoever wins this transition is the only
      // request that will ever call createOrder for this booking.
      await this.store.transition(id, 'CONFIRMING', 'GUEST', 'Confirmation started (demo payment)', {
        patch: { confirmIdempotencyKey: idempotencyKey },
      });
    } catch (err) {
      if (!(err instanceof IllegalTransitionError)) throw err;
      booking = await this.store.get(id);
      if (booking.confirmIdempotencyKey) return this.replayConfirm(booking, idempotencyKey);
      throw illegalState(booking.status);
    }

    booking = await this.store.get(id);
    let result: OrderResult;
    try {
      // No request AbortSignal on purpose: a client disconnect must never cancel a booking mid-flight.
      result = await this.adapter.createOrder(this.orderInput(booking), { timeoutMs: ORDER_TIMEOUT_MS });
    } catch (err) {
      // Not a SupplierError = our bug; the booking stays CONFIRMING and the stuck alert reports it.
      if (!(err instanceof SupplierError)) throw err;
      logSupplierError(this.logger, `createOrder booking=${id}`, err);
      if (err.code === 'TIMEOUT') {
        // The order may exist. Never re-create it: GET /bookings/:id settles via retrieveOrder.
        await this.store.recordEvent(this.store.prisma, id, 'CONFIRMING', 'SYSTEM', 'Supplier timed out; outcome unknown');
        return { httpStatus: HttpStatus.ACCEPTED, booking: await this.view(await this.store.get(id)) };
      }
      throw await this.fail(booking, err);
    }

    booking = await this.settle(booking, result);
    return {
      httpStatus: booking.status === 'CONFIRMING' ? HttpStatus.ACCEPTED : HttpStatus.OK,
      booking: await this.view(booking),
    };
  }

  /** Same Idempotency-Key → the same outcome as the first call; a different key → 409. */
  private async replayConfirm(booking: BookingWithDetails, idempotencyKey: string): Promise<ConfirmResult> {
    if (booking.confirmIdempotencyKey !== idempotencyKey) {
      throw bookingError(HttpStatus.CONFLICT, 'IDEMPOTENCY_CONFLICT', 'This booking is already being confirmed with another key.');
    }
    if (booking.status === 'FAILED') {
      const data = (await this.store.lastEventData(booking.id, 'FAILED')) ?? {};
      throw this.failureException(booking.failureCode as BookingErrorCode, booking.failureReason ?? '', data);
    }
    return {
      httpStatus: booking.status === 'CONFIRMING' ? HttpStatus.ACCEPTED : HttpStatus.OK,
      booking: await this.view(booking),
    };
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
      expectedTotal: supplierTotal(booking),
      // One order attempt per booking, so the booking id is the supplier-side idempotency key.
      idempotencyKey: booking.id,
    };
  }

  /** Apply an order result. Tolerates a concurrent settle (GET recovery vs. confirm). */
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

  private async fail(booking: BookingWithDetails, err: SupplierError): Promise<Error> {
    const { code, message } = failureOf(err);
    const data: Record<string, unknown> = { supplierCode: err.code };
    if (code === 'PRICE_CHANGED') {
      data.previousTotal = toMoney(booking.totalAmount, booking.currency);
      // The supplier's new fare + add-ons, plus the insurance the customer opted into. Best effort:
      // nothing here may throw before the FAILED transition below.
      if (err.newTotal?.currency === booking.currency) {
        data.newTotal = bookingTotals(err.newTotal, [], toMoney(booking.insuranceAmount, booking.currency)).total;
      }
    }
    await this.store.transition(booking.id, 'FAILED', 'SYSTEM', `Order failed: ${err.code}`, {
      patch: { failureCode: code, failureReason: message },
      data: data as Prisma.InputJsonValue,
    });
    return this.failureException(code, message, data);
  }

  private failureException(code: BookingErrorCode, message: string, data: Record<string, unknown>): Error {
    switch (code) {
      case 'PRICE_CHANGED':
        return bookingError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, {
          previousTotal: data.previousTotal as Money | undefined,
          newTotal: data.newTotal as Money | undefined,
        });
      case 'BOOKING_EXPIRED':
        return bookingError(HttpStatus.GONE, code, message);
      case 'BOOKING_REJECTED':
        return bookingError(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
      default:
        return bookingError(HttpStatus.BAD_GATEWAY, 'SUPPLIER_ERROR', message);
    }
  }

  /** CONFIRMING after a lost response: ask the supplier whether the order exists (throttled). */
  private async recover(booking: BookingWithDetails): Promise<BookingWithDetails> {
    if (booking.supplier !== this.adapter.name) return booking;
    if (!(await this.acquireRecoverySlot(booking.id))) return booking;
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

  // ---------------------------------------------------------------------------------------------
  // Helpers

  /** Token check + lazy expiry. Unknown id, missing or wrong token all → the same 404. */
  private async load(id: string, token: string | undefined): Promise<BookingWithDetails> {
    const booking = await this.store.find(id);
    if (!booking || !token || !tokenMatches(token, booking.guestTokenHash)) throw bookingNotFound();
    if (EXPIRABLE.includes(booking.status) && booking.offerExpiresAt.getTime() <= Date.now()) {
      try {
        await this.store.transition(id, 'EXPIRED', 'SYSTEM', 'Offer expired');
      } catch (err) {
        if (!(err instanceof IllegalTransitionError)) throw err; // a concurrent request moved it first
      }
      return this.store.get(id);
    }
    return booking;
  }

  private requireStatus(booking: BookingWithDetails, ...allowed: BookingStatus[]): void {
    if (allowed.includes(booking.status)) return;
    if (booking.status === 'EXPIRED') {
      throw bookingError(HttpStatus.GONE, 'BOOKING_EXPIRED', 'This booking has expired. Please search again.');
    }
    throw illegalState(booking.status);
  }

  // A booking can only be served by the supplier it was made with (SUPPLIER may have changed).
  private assertSupplier(booking: BookingWithDetails): void {
    if (booking.supplier !== this.adapter.name) throw new GoneException(GONE_MESSAGE);
  }

  private supplierCall<T>(booking: BookingWithDetails, operation: string, call: () => Promise<T>): Promise<T> {
    this.assertSupplier(booking);
    return callSupplier(this.logger, `${operation} booking=${booking.id}`, call);
  }

  private async fetchAncillaries(booking: BookingWithDetails, opts: { fresh?: boolean } = {}): Promise<Ancillaries> {
    return this.cached(booking, ancillariesKey(booking.id), opts, () =>
      this.adapter.getAncillaries(booking.supplierOfferId, { timeoutMs: SUPPLIER_TIMEOUT_MS }),
    );
  }

  private async fetchSeatMaps(booking: BookingWithDetails, opts: { fresh?: boolean } = {}): Promise<SeatMap[]> {
    return this.cached(booking, seatMapsKey(booking.id), opts, () =>
      this.adapter.getSeatMaps(booking.supplierOfferId, { timeoutMs: SUPPLIER_TIMEOUT_MS }),
    );
  }

  // Cache-aside per booking, TTL = until the offer expires. `fresh` skips the read but refreshes it.
  private async cached<T>(booking: BookingWithDetails, key: string, opts: { fresh?: boolean }, load: () => Promise<T>): Promise<T> {
    if (!opts.fresh) {
      const hit = await this.cache.get<T>(key);
      if (hit) return hit;
    }
    const value = await this.supplierCall(booking, key.split(':')[1], load);
    const ttl = Math.floor((booking.offerExpiresAt.getTime() - Date.now()) / 1000);
    if (ttl > 0) await this.cache.set(key, value, ttl);
    return value;
  }

  private totalsOrBadGateway(fare: Money, addOns: Money[], insurance: Money | null) {
    try {
      return bookingTotals(fare, addOns, insurance);
    } catch {
      // Supplier priced add-ons in another currency than the fare: can't add them up honestly.
      throw new BadGatewayException('The flight supplier returned inconsistent prices. Please try again.');
    }
  }

  /** Airports on the itinerary (display data) + whether the trip crosses a border. */
  private async trip(booking: BookingWithDetails): Promise<{ airports: Record<string, BookingAirport>; international: boolean }> {
    const codes = itineraryAirports(offerOf(booking));
    const rows = await this.store.airports(codes);
    return {
      airports: Object.fromEntries(rows.map(({ iataCode, ...a }) => [iataCode, a])),
      international: isInternationalTrip(codes, rows),
    };
  }

  /** The supplier's answer when it gives one; otherwise passports are required on international trips. */
  private async documentRequired(booking: BookingWithDetails, ancillaries: Ancillaries): Promise<boolean> {
    return ancillaries.passengerRequirements.identityDocumentRequired ?? (await this.trip(booking)).international;
  }

  private async view(booking: BookingWithDetails): Promise<PublicBooking> {
    const offer = offerOf(booking);
    const [quotes, trip] = await Promise.all([
      this.insurance.quote({ fare: toMoney(booking.fareAmount, booking.currency) }, offer.passengers),
      this.trip(booking),
    ]);
    return toPublicBooking(booking, { decrypt: (v) => this.crypto.decrypt(v), quotes, ...trip });
  }
}

type StoredDocument = { type: 'passport'; numberEnc: string; issuingCountry: string; expiryDate: string };
type NewDocument = { type: 'passport'; number: string; issuingCountry: string; expiryDate: string };
type ResolvedPassenger = RulesPassenger & { document?: StoredDocument | NewDocument | null };

/**
 * `document: { keepExisting: true }` → the passport already stored for that passenger slot (still
 * encrypted). No stored passport → DOCUMENT_REQUIRED at that passenger's document.
 */
function keepStoredDocuments(
  passengers: UpdateBookingDetailsBody['passengers'],
  booking: BookingWithDetails,
): { passengers: ResolvedPassenger[]; issues: BookingIssue[] } {
  const issues: BookingIssue[] = [];
  const resolved = passengers.map((p, i): ResolvedPassenger => {
    if (!p.document || !('keepExisting' in p.document)) return p as ResolvedPassenger;
    const stored = booking.passengers.find((s) => s.supplierPassengerId === p.ref);
    if (!stored?.documentNumberEnc || !stored.documentIssuingCountry || !stored.documentExpiryDate) {
      issues.push({
        code: 'DOCUMENT_REQUIRED',
        path: `passengers.${i}.document`,
        message: 'There is no saved passport to keep. Please enter the passport details.',
      });
      return { ...p, document: null };
    }
    return {
      ...p,
      document: {
        type: 'passport',
        numberEnc: stored.documentNumberEnc,
        issuingCountry: stored.documentIssuingCountry,
        expiryDate: stored.documentExpiryDate.toISOString().slice(0, 10),
      },
    };
  });
  return { passengers: resolved, issues };
}

function snapshotOf(offer: PricedOffer): Prisma.InputJsonValue {
  const { priceChanged: _changed, previousTotal: _previous, ...rest } = offer;
  return toPublicOffer(rest) as unknown as Prisma.InputJsonValue;
}

function offerOf(booking: BookingWithDetails): PublicFlightOffer {
  return booking.offerSnapshot as unknown as PublicFlightOffer;
}

/** What the supplier charges: fare + bags/seats (insurance is ours, not the airline's). */
function supplierTotal(booking: BookingWithDetails): Money {
  return bookingTotals(
    toMoney(booking.fareAmount, booking.currency),
    [toMoney(booking.ancillariesAmount, booking.currency)],
    null,
  ).total;
}

function fits(entry: CatalogueEntry | undefined, quantity: number): boolean {
  return entry !== undefined && quantity <= entry.maxQuantity;
}

function failureOf(err: SupplierError): { code: BookingErrorCode; message: string } {
  switch (err.code) {
    case 'PRICE_CHANGED':
      return { code: 'PRICE_CHANGED', message: 'The airline changed the price. Please start a new booking.' };
    case 'OFFER_EXPIRED':
    case 'OFFER_NOT_FOUND':
      return { code: 'BOOKING_EXPIRED', message: GONE_MESSAGE };
    case 'INVALID_REQUEST':
      return { code: 'BOOKING_REJECTED', message: 'The airline rejected the booking details.' };
    default:
      return { code: 'SUPPLIER_ERROR', message: 'The airline could not confirm this booking.' };
  }
}

function illegalState(current: BookingStatus): Error {
  return bookingError(HttpStatus.CONFLICT, 'ILLEGAL_STATE', `This action is not possible while the booking is ${current}.`);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Compare hashes (fixed length) in constant time, so response timing reveals nothing about the token.
function tokenMatches(token: string, storedHash: string): boolean {
  const presented = createHash('sha256').update(token).digest();
  const stored = Buffer.from(storedHash, 'hex');
  return stored.length === presented.length && timingSafeEqual(presented, stored);
}

function upper<T extends string>(value: T): Uppercase<T> {
  return value.toUpperCase() as Uppercase<T>;
}

function lower<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>;
}
