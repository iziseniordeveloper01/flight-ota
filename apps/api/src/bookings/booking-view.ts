import type {
  BookingAirport,
  BookingDisplayPrice,
  InsuranceQuote,
  PaymentProviderName,
  PublicBooking,
  SupplierOffer,
} from '@ota/contracts';
import type { Prisma } from '@ota/db';
import { currencyDigits, sumMoney, type Money, type SupplierName } from '@ota/suppliers';
import type { FxSnapshot } from '../pricing/pricing.js';
import type { BookingWithDetails } from './booking-store.service.js';

/** Decimal column → Money in the currency's own precision ("12.300" → "12.30" for USD). */
export function toMoney(value: Prisma.Decimal, currency: string): Money {
  return { amount: value.toFixed(currencyDigits(currency)), currency };
}

/** True once the booking has charge amounts (every booking created since payments exist). */
export function hasChargeSnapshot(b: BookingWithDetails): b is BookingWithDetails & {
  chargeCurrency: string;
  chargeFareAmount: Prisma.Decimal;
  chargeTotalAmount: Prisma.Decimal;
} {
  return b.chargeCurrency !== null && b.chargeFareAmount !== null && b.chargeTotalAmount !== null;
}

/** The exchange rate stored with the booking (null on rows from before payments existed). */
export function fxSnapshotOf(b: BookingWithDetails): FxSnapshot | null {
  if (!b.chargeCurrency || !b.fxRate || !b.fxBufferPercent || !b.fxSource || !b.fxFetchedAt) return null;
  return {
    base: b.currency,
    quote: b.chargeCurrency,
    rate: b.fxRate.toFixed(),
    bufferPercent: b.fxBufferPercent.toFixed(),
    source: b.fxSource,
    fetchedAt: b.fxFetchedAt.toISOString(),
  };
}

/** Booking columns for an FX snapshot. */
export function fxColumns(fx: FxSnapshot) {
  return {
    chargeCurrency: fx.quote,
    fxRate: fx.rate,
    fxBufferPercent: fx.bufferPercent,
    fxSource: fx.source,
    fxFetchedAt: new Date(fx.fetchedAt),
  };
}

/**
 * What the customer pays, from the stored charge columns. Rows from before payments existed have
 * none: they show the supplier amounts (and cannot be paid — payment-order answers 409).
 */
export function displayPriceOf(b: BookingWithDetails): BookingDisplayPrice {
  if (!hasChargeSnapshot(b)) {
    const sum = (type: 'BAG' | 'SEAT') => sumMoney(b.ancillaries.filter((a) => a.type === type).map((a) => toMoney(a.amount, a.currency)), b.currency);
    const zero = sumMoney([], b.currency);
    return { currency: b.currency, fare: toMoney(b.fareAmount, b.currency), baggage: sum('BAG'), seats: sum('SEAT'), insurance: zero, total: toMoney(b.totalAmount, b.currency) };
  }
  const c = b.chargeCurrency;
  const money = (value: Prisma.Decimal | null) => (value ? toMoney(value, c) : sumMoney([], c));
  return {
    currency: c,
    fare: money(b.chargeFareAmount),
    baggage: money(b.chargeBagsAmount),
    seats: money(b.chargeSeatsAmount),
    insurance: money(b.chargeInsuranceAmount),
    total: money(b.chargeTotalAmount),
  };
}

/** "X1234567" → "*****567": enough for the customer to recognise it, useless to anyone else. */
export function maskDocumentNumber(number: string): string {
  return '*'.repeat(Math.max(0, number.length - 3)) + number.slice(-3);
}

/**
 * The ONLY shape a booking leaves the API in. Deliberately built field by field (allow-list):
 * supplierRef, supplierOfferId, supplierOrderId, guestTokenHash and raw document numbers can
 * never leak through a spread.
 */
export function toPublicBooking(
  b: BookingWithDetails,
  ctx: {
    decrypt: (value: string) => string;
    quotes: InsuranceQuote[];
    airports: Record<string, BookingAirport>;
    international: boolean;
    paymentProvider: PaymentProviderName;
  },
): PublicBooking {
  const money = (value: Prisma.Decimal) => toMoney(value, b.currency);
  const refById = new Map(b.passengers.map((p) => [p.id, p.supplierPassengerId]));
  const insurance = b.ancillaries.find((a) => a.type === 'INSURANCE');
  const displayPrice = displayPriceOf(b);
  // The latest refund (uuid v7 ids are time-ordered) — what the customer is waiting for.
  const refund = b.payments.flatMap((p) => p.refunds).sort((x, y) => (x.id < y.id ? -1 : 1)).at(-1);
  const offer = b.offerSnapshot as unknown as SupplierOffer;
  const contact =
    b.contactTitle && b.contactGivenName && b.contactEmail && b.contactPhone
      ? {
          title: lower(b.contactTitle),
          givenName: b.contactGivenName,
          familyName: b.contactFamilyName,
          email: b.contactEmail,
          phone: b.contactPhone,
        }
      : null;

  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    supplier: b.supplier as SupplierName,
    // Mock and Duffel test mode are not real inventory; only TBO (later) is.
    demo: b.supplier !== 'tbo',
    offer: { ...offer, displayPrice: { total: displayPrice.fare } },
    airports: ctx.airports,
    trip: { international: ctx.international },
    expiresAt: b.offerExpiresAt.toISOString(),
    price: {
      currency: b.currency,
      fare: money(b.fareAmount),
      ancillaries: money(b.ancillariesAmount),
      total: money(b.totalAmount),
    },
    displayPrice,
    payment: {
      provider: ctx.paymentProvider,
      refund: refund ? { amount: toMoney(refund.amount, refund.currency), status: lower(refund.status) } : null,
    },
    contact,
    passengers: b.passengers.map((p) => ({
      ref: p.supplierPassengerId,
      position: p.position,
      type: lower(p.type),
      title: lower(p.title),
      gender: lower(p.gender),
      givenName: p.givenName,
      familyName: p.familyName,
      dateOfBirth: ctx.decrypt(p.dateOfBirthEnc),
      nationality: p.nationality,
      document:
        p.documentNumberEnc && p.documentIssuingCountry && p.documentExpiryDate
          ? {
              type: 'passport',
              numberMasked: maskDocumentNumber(ctx.decrypt(p.documentNumberEnc)),
              issuingCountry: p.documentIssuingCountry,
              expiryDate: p.documentExpiryDate.toISOString().slice(0, 10),
            }
          : null,
      associatedAdultRef: p.infantAssociatedAdultId ? (refById.get(p.infantAssociatedAdultId) ?? null) : null,
    })),
    ancillaries: b.ancillaries.map((a) => ({
      type: lower(a.type),
      passengerRef: a.passengerId ? (refById.get(a.passengerId) ?? null) : null,
      segmentRef: a.segmentRef,
      serviceId: a.type === 'INSURANCE' ? null : a.supplierServiceId,
      label: a.label,
      quantity: a.quantity,
      amount: toMoney(a.amount, a.currency),
      displayAmount: a.chargeAmount && b.chargeCurrency ? toMoney(a.chargeAmount, b.chargeCurrency) : toMoney(a.amount, a.currency),
    })),
    insurance: {
      quotes: ctx.quotes,
      selectedQuoteId: insurance?.supplierServiceId ?? null,
      policyNumber: b.insurancePolicyNumber,
      demo: ctx.quotes.every((q) => q.demo),
    },
    pnr: b.pnr,
    confirmedAt: b.confirmedAt?.toISOString() ?? null,
    failure: b.failureCode ? { code: b.failureCode, message: b.failureReason ?? '' } : null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

function lower<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>;
}
