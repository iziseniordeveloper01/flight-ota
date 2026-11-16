import type { BookingAirport, InsuranceQuote, PublicBooking, PublicFlightOffer } from '@ota/contracts';
import type { Prisma } from '@ota/db';
import { currencyDigits, type Money, type SupplierName } from '@ota/suppliers';
import type { BookingWithDetails } from './booking-store.service.js';

/** Decimal column → Money in the currency's own precision ("12.300" → "12.30" for USD). */
export function toMoney(value: Prisma.Decimal, currency: string): Money {
  return { amount: value.toFixed(currencyDigits(currency)), currency };
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
  },
): PublicBooking {
  const money = (value: Prisma.Decimal) => toMoney(value, b.currency);
  const refById = new Map(b.passengers.map((p) => [p.id, p.supplierPassengerId]));
  const insurance = b.ancillaries.find((a) => a.type === 'INSURANCE');
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
    offer: b.offerSnapshot as unknown as PublicFlightOffer,
    airports: ctx.airports,
    trip: { international: ctx.international },
    expiresAt: b.offerExpiresAt.toISOString(),
    price: {
      currency: b.currency,
      fare: money(b.fareAmount),
      ancillaries: money(b.ancillariesAmount),
      insurance: money(b.insuranceAmount),
      total: money(b.totalAmount),
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
