import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadGatewayException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  lastFlightDate,
  type BookingAirport,
  type BookingErrorCode,
  type BookingIssue,
  type BookingWarning,
  type InsuranceQuote,
  type PublicAncillaries,
  type PublicBooking,
  type PublicSeatMap,
  type SupplierOffer,
  type UpdateBookingDetailsBody,
} from '@ota/contracts';
import type { AncillaryType, BookingStatus, Prisma } from '@ota/db';
import {
  compareMoney,
  multiplyMoney,
  type Ancillaries,
  type Money,
  type OfferPassenger,
  type PricedOffer,
  type SeatMap,
  type SupplierAdapter,
} from '@ota/suppliers';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { FlightsService } from '../flights/flights.service.js';
import { toPublicOffer } from '../flights/public-offer.js';
import { callSupplier, fareNoLongerAvailable } from '../flights/supplier-errors.js';
import { SUPPLIER_ADAPTER } from '../flights/supplier.provider.js';
import { INSURANCE_PROVIDER, type InsuranceProvider } from '../insurance/insurance.provider.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/payment-provider.js';
import type { PriceQuote } from '../pricing/pricing.js';
import { PricingService } from '../pricing/pricing.service.js';
import { JsonCacheService } from '../redis/json-cache.service.js';
import { bookingError, bookingNotFound, rulesViolated } from './booking-errors.js';
import { withUniqueReference } from './booking-reference.js';
import {
  buildCatalogue,
  chargeTotals,
  checkPassengers,
  isInternationalTrip,
  itineraryAirports,
  priceServices,
  supplierTotals,
  type CatalogueEntry,
  type RulesPassenger,
} from './booking-rules.js';
import { EXPIRABLE, IllegalTransitionError } from './booking-state.js';
import { BOOKING_DETAILS, BookingStore, isUniqueViolation, TX_OPTIONS, type BookingWithDetails, type Tx } from './booking-store.service.js';
import { displayPriceOf, fxColumns, fxSnapshotOf, hasChargeSnapshot, toMoney, toPublicBooking } from './booking-view.js';
import { StuckBookingsMonitor } from './stuck-bookings.monitor.js';
import { TicketingService } from './ticketing.service.js';

const SUPPLIER_TIMEOUT_MS = 30_000;

const ancillariesKey = (id: string) => `bookings:ancillaries:v1:${id}`;
const seatMapsKey = (id: string) => `bookings:seat-maps:v1:${id}`;

export interface ConfirmResult {
  /** 200 settled, 202 still PAID/CONFIRMING. */
  httpStatus: HttpStatus.OK | HttpStatus.ACCEPTED;
  booking: PublicBooking;
}

/**
 * Guest checkout. Two sides of every price: the SUPPLIER's (what the airline charges, its currency)
 * and the CHARGE side (what the customer pays, CHARGE_CURRENCY) — converted with the FX snapshot
 * stored on the booking (taken at creation, refreshed at checkout).
 */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly store: BookingStore,
    private readonly flights: FlightsService,
    private readonly crypto: FieldEncryptionService,
    private readonly cache: JsonCacheService,
    private readonly monitor: StuckBookingsMonitor,
    private readonly pricing: PricingService,
    private readonly ticketing: TicketingService,
    @Inject(SUPPLIER_ADAPTER) private readonly adapter: SupplierAdapter,
    @Inject(INSURANCE_PROVIDER) private readonly insurance: InsuranceProvider,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Create

  async create(offerId: string): Promise<{
    booking: PublicBooking;
    guestToken: string;
    priceChanged: boolean;
    previousTotal?: Money;
  }> {
    // The same fare from a fresh search (one order per supplier search), priced against what the
    // customer saw. 410 FARE_NO_LONGER_AVAILABLE when it's gone.
    const priced = await this.flights.reshop(offerId);
    const total = priced.price.total;
    const quote = await this.pricing.quote(total.currency);
    const fare = quote.fare(total);
    const previousTotal = priced.previousTotal ? await this.pricing.displayFare(priced.previousTotal, quote) : undefined;
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
              ...fxColumns(quote.fx),
              chargeFareAmount: fare.charge.amount,
              chargeMarkupAmount: fare.markup.amount,
              chargeBagsAmount: 0,
              chargeSeatsAmount: 0,
              chargeInsuranceAmount: 0,
              chargeTotalAmount: fare.charge.amount,
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
              data: { priceChanged: priced.priceChanged, fxRate: quote.fx.rate, fxSource: quote.fx.source },
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
      ...(previousTotal ? { previousTotal } : {}),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Read

  async get(id: string, token: string | undefined): Promise<PublicBooking> {
    let booking = await this.load(id, token);
    if (booking.status === 'CONFIRMING') {
      await this.monitor.warnIfStuck(booking);
      booking = await this.ticketing.recover(booking, { throttle: true });
    }
    return this.view(booking);
  }

  async ancillaries(id: string, token: string | undefined): Promise<PublicAncillaries> {
    const booking = await this.load(id, token);
    this.requireStatus(booking, 'DRAFT', 'PENDING_PAYMENT');
    const [ancillaries, quote] = await Promise.all([this.fetchAncillaries(booking), this.quoteFor(booking)]);
    return {
      ...ancillaries,
      bags: ancillaries.bags.map((bag) => ({ ...bag, displayPrice: quote.line(bag.price) })),
      passengerRequirements: {
        ...ancillaries.passengerRequirements,
        identityDocumentRequired: await this.documentRequired(booking, ancillaries),
      },
    };
  }

  async seatMaps(id: string, token: string | undefined): Promise<PublicSeatMap[]> {
    const booking = await this.load(id, token);
    this.requireStatus(booking, 'DRAFT', 'PENDING_PAYMENT');
    const [maps, quote] = await Promise.all([this.fetchSeatMaps(booking), this.quoteFor(booking)]);
    return maps.map((map) => withSeatDisplayPrices(map, quote));
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
    const quote = await this.quoteFor(booking);
    const chargeFare = quote.fare(fare);
    let insuranceQuote: InsuranceQuote | undefined;
    if (body.insurance) {
      // Insurance is quoted in the charge currency, on the fare the customer pays.
      insuranceQuote = (await this.insurance.quote({ fare: chargeFare.charge }, offer.passengers)).find((q) => q.quoteId === body.insurance!.quoteId);
      if (!insuranceQuote) {
        allIssues.push({ code: 'INSURANCE_QUOTE_INVALID', path: 'insurance.quoteId', message: 'This insurance plan is not available.' });
      }
    }
    if (allIssues.length) throw rulesViolated(allIssues);

    const lines = priced.lines.map((line) => ({ ...line, charge: quote.line(line.amount) }));
    const supplier = this.totalsOrBadGateway(() => supplierTotals(fare, lines.map((l) => l.amount)));
    const charge = chargeTotals(quote.chargeCurrency, {
      fare: chargeFare.charge,
      bags: lines.filter((l) => l.entry.kind === 'bag').map((l) => l.charge),
      seats: lines.filter((l) => l.entry.kind === 'seat').map((l) => l.charge),
      insurance: insuranceQuote?.total ?? null,
    });

    await this.store.prisma.$transaction(async (tx) => {
      const status = await this.store.lockStatus(tx, id);
      if (status !== 'DRAFT') throw illegalState(status);
      await tx.bookingAncillary.deleteMany({ where: { bookingId: id } });
      await tx.bookingPassenger.deleteMany({ where: { bookingId: id } });

      const idByRef = await this.insertPassengers(tx, id, offer.passengers, kept.passengers);
      await tx.bookingAncillary.createMany({
        data: [
          ...lines.map((line) => ({
            bookingId: id,
            passengerId: idByRef.get(line.entry.passengerRef) ?? null,
            type: (line.entry.kind === 'bag' ? 'BAG' : 'SEAT') as AncillaryType,
            segmentRef: line.entry.segmentRef,
            supplierServiceId: line.entry.serviceId,
            label: line.label,
            quantity: line.quantity,
            amount: line.amount.amount,
            currency: line.amount.currency,
            chargeAmount: line.charge.amount,
          })),
          ...(insuranceQuote
            ? [{
                bookingId: id,
                type: 'INSURANCE' as const,
                supplierServiceId: insuranceQuote.quoteId,
                label: insuranceQuote.name,
                quantity: offer.passengers.length,
                amount: insuranceQuote.total.amount,
                currency: insuranceQuote.total.currency,
                chargeAmount: insuranceQuote.total.amount,
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
          ancillariesAmount: supplier.ancillaries.amount,
          totalAmount: supplier.total.amount,
          ...chargeColumns(quote, chargeFare.markup, charge),
        },
      });
      await this.store.recordEvent(tx, id, 'DRAFT', 'GUEST', 'Details updated', {
        passengers: body.passengers.length,
        services: lines.length,
        insurance: Boolean(insuranceQuote),
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
  // Checkout: fresh re-price of fare + add-ons at today's exchange rate, then DRAFT → PENDING_PAYMENT

  async checkout(id: string, token: string | undefined): Promise<PublicBooking> {
    const booking = await this.load(id, token);
    this.requireStatus(booking, 'DRAFT');
    const offer = offerOf(booking);
    if (!booking.contactEmail || booking.passengers.length !== offer.passengers.length) {
      throw bookingError(HttpStatus.UNPROCESSABLE_ENTITY, 'DETAILS_INCOMPLETE', 'Add passenger and contact details first.');
    }

    // Bypass every cache: this is the price the customer will pay.
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
    if (fare.currency !== booking.currency) {
      throw new BadGatewayException('The flight supplier changed the currency of this offer. Please search again.');
    }
    const quote = await this.pricing.quote(fare.currency);
    const chargeFare = quote.fare(fare);
    const insuranceRow = booking.ancillaries.find((a) => a.type === 'INSURANCE');
    const insuranceQuote = insuranceRow
      ? (await this.insurance.quote({ fare: chargeFare.charge }, offer.passengers)).find((q) => q.quoteId === insuranceRow.supplierServiceId)
      : undefined;
    if (insuranceRow && !insuranceQuote) unavailable.push(insuranceRow.supplierServiceId ?? '');

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

    const lines = services.map((a) => {
      const amount = multiplyMoney(catalogue.get(a.supplierServiceId!)!.unitPrice, a.quantity);
      return { id: a.id, type: a.type, amount, charge: quote.line(amount) };
    });
    const supplier = this.totalsOrBadGateway(() => supplierTotals(fare, lines.map((l) => l.amount)));
    const charge = chargeTotals(quote.chargeCurrency, {
      fare: chargeFare.charge,
      bags: lines.filter((l) => l.type === 'BAG').map((l) => l.charge),
      seats: lines.filter((l) => l.type === 'SEAT').map((l) => l.charge),
      insurance: insuranceQuote?.total ?? null,
    });
    // What the customer pays is what matters: compare the charge totals.
    const previousTotal = displayPriceOf(booking).total;
    const changed = previousTotal.currency !== charge.total.currency || compareMoney(charge.total, previousTotal) !== 0;

    await this.store.prisma.$transaction(async (tx) => {
      const status = await this.store.lockStatus(tx, id);
      if (status !== 'DRAFT') throw illegalState(status);
      // Store the latest amounts either way: what we show is what the supplier just quoted.
      for (const line of lines) {
        await tx.bookingAncillary.update({ where: { id: line.id }, data: { amount: line.amount.amount, chargeAmount: line.charge.amount } });
      }
      if (insuranceRow && insuranceQuote) {
        await tx.bookingAncillary.update({
          where: { id: insuranceRow.id },
          data: { amount: insuranceQuote.total.amount, currency: insuranceQuote.total.currency, chargeAmount: insuranceQuote.total.amount },
        });
      }
      const patch = {
        offerSnapshot: snapshotOf(fresh),
        supplierRef: fresh.supplierRef as Prisma.InputJsonValue,
        offerExpiresAt: new Date(fresh.expiresAt),
        fareAmount: supplier.fare.amount,
        ancillariesAmount: supplier.ancillaries.amount,
        totalAmount: supplier.total.amount,
        ...chargeColumns(quote, chargeFare.markup, charge),
      };
      if (changed) {
        await tx.booking.update({ where: { id }, data: patch });
        await this.store.recordEvent(tx, id, 'DRAFT', 'SYSTEM', 'Price changed at checkout', {
          previousTotal: { ...previousTotal },
          newTotal: { ...charge.total },
        });
      } else {
        await this.store.transition(id, 'PENDING_PAYMENT', 'GUEST', 'Checkout', {
          patch,
          tx,
          data: { chargeTotal: { ...charge.total }, fxRate: quote.fx.rate, fxSource: quote.fx.source },
        });
      }
    }, TX_OPTIONS);

    if (changed) {
      // Stays DRAFT: calling checkout again accepts the new price.
      throw bookingError(HttpStatus.UNPROCESSABLE_ENTITY, 'PRICE_CHANGED', 'The price has changed. Please review the new total.', {
        previousTotal,
        newTotal: charge.total,
      });
    }
    return this.view(await this.store.get(id));
  }

  // ---------------------------------------------------------------------------------------------
  // Demo confirmation (PAYMENT_PROVIDER=demo only): PENDING_PAYMENT → PAID → ticketing inline

  get paymentProvider(): PaymentProvider['name'] {
    return this.payments.name;
  }

  async confirmDemo(id: string, token: string | undefined, idempotencyKey: string): Promise<ConfirmResult> {
    let booking = await this.load(id, token);
    if (booking.confirmIdempotencyKey) return this.replayConfirm(booking, idempotencyKey);
    this.requireStatus(booking, 'PENDING_PAYMENT');
    this.assertSupplier(booking);

    try {
      // The key is stored in the same locked UPDATE: whoever wins this transition is the only
      // request that will ever start ticketing for this booking.
      await this.store.transition(id, 'PAID', 'GUEST', 'Paid (demo, no money taken)', {
        patch: { confirmIdempotencyKey: idempotencyKey },
        data: { provider: 'demo' },
      });
    } catch (err) {
      if (!(err instanceof IllegalTransitionError)) throw err;
      booking = await this.store.get(id);
      if (booking.confirmIdempotencyKey) return this.replayConfirm(booking, idempotencyKey);
      throw illegalState(booking.status);
    }
    // Inline (not queued) so the demo keeps its synchronous 200 / 202 contract.
    return this.confirmResult(await this.ticketing.ticket(id));
  }

  /** Same Idempotency-Key → the same outcome as the first call; a different key → 409. */
  private async replayConfirm(booking: BookingWithDetails, idempotencyKey: string): Promise<ConfirmResult> {
    if (booking.confirmIdempotencyKey !== idempotencyKey) {
      throw bookingError(HttpStatus.CONFLICT, 'IDEMPOTENCY_CONFLICT', 'This booking is already being confirmed with another key.');
    }
    return this.confirmResult(booking);
  }

  private async confirmResult(booking: BookingWithDetails): Promise<ConfirmResult> {
    if (booking.status === 'FAILED') {
      const data = (await this.store.lastEventData(booking.id, 'FAILED')) ?? {};
      throw failureException(booking.failureCode as BookingErrorCode, booking.failureReason ?? '', data);
    }
    return {
      httpStatus: booking.status === 'CONFIRMED' ? HttpStatus.OK : HttpStatus.ACCEPTED,
      booking: await this.view(booking),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers (load/view are shared with PaymentsService)

  /** Token check + lazy expiry. Unknown id, missing or wrong token all → the same 404. */
  async load(id: string, token: string | undefined): Promise<BookingWithDetails> {
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

  requireStatus(booking: BookingWithDetails, ...allowed: BookingStatus[]): void {
    if (allowed.includes(booking.status)) return;
    if (booking.status === 'EXPIRED') {
      throw bookingError(HttpStatus.GONE, 'BOOKING_EXPIRED', 'This booking has expired. Please search again.');
    }
    throw illegalState(booking.status);
  }

  async view(booking: BookingWithDetails): Promise<PublicBooking> {
    const offer = offerOf(booking);
    const [quotes, trip] = await Promise.all([
      this.insurance.quote({ fare: displayPriceOf(booking).fare }, offer.passengers),
      this.trip(booking),
    ]);
    return toPublicBooking(booking, { decrypt: (v) => this.crypto.decrypt(v), quotes, paymentProvider: this.payments.name, ...trip });
  }

  /** The booking's own exchange rate; a fresh one for rows from before payments existed. */
  private async quoteFor(booking: BookingWithDetails): Promise<PriceQuote> {
    const fx = hasChargeSnapshot(booking) ? fxSnapshotOf(booking) : null;
    return fx ? this.pricing.fromSnapshot(fx) : this.pricing.quote(booking.currency);
  }

  // A booking can only be served by the supplier it was made with (SUPPLIER may have changed).
  private assertSupplier(booking: BookingWithDetails): void {
    if (booking.supplier !== this.adapter.name) throw fareNoLongerAvailable();
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

  private totalsOrBadGateway<T>(compute: () => T): T {
    try {
      return compute();
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

/** Charge columns (+ FX snapshot) for a booking update. */
function chargeColumns(quote: PriceQuote, markup: Money, charge: ReturnType<typeof chargeTotals>) {
  return {
    ...fxColumns(quote.fx),
    chargeFareAmount: charge.fare.amount,
    chargeMarkupAmount: markup.amount,
    chargeBagsAmount: charge.baggage.amount,
    chargeSeatsAmount: charge.seats.amount,
    chargeInsuranceAmount: charge.insurance.amount,
    chargeTotalAmount: charge.total.amount,
  };
}

function withSeatDisplayPrices(map: SeatMap, quote: PriceQuote): PublicSeatMap {
  return {
    ...map,
    cabins: map.cabins.map((cabin) => ({
      ...cabin,
      rows: cabin.rows.map((row) => ({
        ...row,
        sections: row.sections.map((section) => ({
          elements: section.elements.map((el) =>
            el.type === 'seat' ? { ...el, services: el.services.map((s) => ({ ...s, displayPrice: quote.line(s.price) })) } : el,
          ),
        })),
      })),
    })),
  };
}

function snapshotOf(offer: PricedOffer): Prisma.InputJsonValue {
  const { priceChanged: _changed, previousTotal: _previous, ...rest } = offer;
  return toPublicOffer(rest) as unknown as Prisma.InputJsonValue;
}

function offerOf(booking: BookingWithDetails): SupplierOffer {
  return booking.offerSnapshot as unknown as SupplierOffer;
}

function fits(entry: CatalogueEntry | undefined, quantity: number): boolean {
  return entry !== undefined && quantity <= entry.maxQuantity;
}

function failureException(code: BookingErrorCode, message: string, data: Record<string, unknown>): Error {
  switch (code) {
    case 'PRICE_CHANGED':
      return bookingError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, {
        previousTotal: data.previousTotal as Money | undefined,
        newTotal: data.newTotal as Money | undefined,
      });
    case 'BOOKING_EXPIRED':
    case 'FARE_NO_LONGER_AVAILABLE':
      return bookingError(HttpStatus.GONE, code, message);
    case 'BOOKING_REJECTED':
      return bookingError(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
    default:
      return bookingError(HttpStatus.BAD_GATEWAY, 'SUPPLIER_ERROR', message);
  }
}

export function illegalState(current: BookingStatus): Error {
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
