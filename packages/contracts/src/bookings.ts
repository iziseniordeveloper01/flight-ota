import type { Ancillaries, Money, PassengerType, SeatMap, SupplierName } from '@ota/suppliers';
import { z } from 'zod';
import { offerIdSchema, type PublicFlightOffer } from './flights.js';

export const BOOKING_STATUSES = [
  'DRAFT',
  'PENDING_PAYMENT',
  'CONFIRMING',
  'CONFIRMED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PASSENGER_TITLES = ['mr', 'mrs', 'ms', 'miss'] as const;
export const GENDERS = ['m', 'f'] as const;
export const PASSENGER_TYPES = ['adult', 'child', 'infant'] as const satisfies readonly PassengerType[];
export const MAX_NAME_LENGTH = 50;
/** Lap infants + seated passengers (9 seated, at most one infant per adult). */
export const MAX_BOOKING_PASSENGERS = 18;
/** A passport expiring within this many months after the last flight triggers a warning. */
export const PASSPORT_WARNING_MONTHS = 6;

// ---------------------------------------------------------------------------------------------
// Age rules — shared so the web form can warn before the API rejects.

/**
 * Completed years on `onDate` (both YYYY-MM-DD). A birthday ON the date counts. Someone born on
 * 29 Feb turns a year older on 1 Mar in non-leap years (28 Feb is still "before the birthday").
 */
export function ageOnDate(dateOfBirth: string, onDate: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  const beforeBirthday = m < bm || (m === bm && d < bd);
  return y - by - (beforeBirthday ? 1 : 0);
}

/** Airline age categories: infant < 2, child 2–11, adult ≥ 12. */
export function passengerTypeForAge(age: number): PassengerType {
  return age < 2 ? 'infant' : age < 12 ? 'child' : 'adult';
}

/** Local date (YYYY-MM-DD) of the last flight's departure: the day airlines apply age rules. */
export function lastFlightDate(offer: Pick<PublicFlightOffer, 'slices'>): string {
  const lastSlice = offer.slices[offer.slices.length - 1];
  const lastSegment = lastSlice.segments[lastSlice.segments.length - 1];
  // Airport-local "YYYY-MM-DDTHH:mm:ss": the date is just the first 10 chars (no Date parsing).
  return lastSegment.departureAt.slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Request schemas

/** Our booking ids are UUIDs (v7). */
export const bookingIdSchema = z.uuid();

/** Client-chosen key for POST /bookings/:id/confirm-demo (header Idempotency-Key). */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency-Key must be 8–100 letters, digits, - or _');

/** POST /v1/bookings */
export const createBookingSchema = z.object({ offerId: offerIdSchema });
export type CreateBookingBody = z.output<typeof createBookingSchema>;

// Airline systems accept plain Latin letters only (no accents): "José" must be entered "Jose".
const NAME_PATTERN = /^[A-Za-z][A-Za-z '-]*$/;
const personName = z
  .string()
  .trim()
  .overwrite((s) => s.replace(/\s+/g, ' '))
  .min(1, 'Required')
  .max(MAX_NAME_LENGTH, `At most ${MAX_NAME_LENGTH} characters`)
  .regex(NAME_PATTERN, 'Use Latin letters, spaces, hyphens or apostrophes only');

const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Must be a 2-letter ISO country code');

const isoDate = z.iso.date('Must be a date in YYYY-MM-DD format');

const passportSchema = z.object({
  type: z.literal('passport'),
  number: z
    .string()
    .trim()
    .toUpperCase()
    .overwrite((s) => s.replace(/[\s-]/g, ''))
    .regex(/^[A-Z0-9]{5,20}$/, 'Passport number must be 5–20 letters or digits'),
  issuingCountry: countryCode,
  expiryDate: isoDate,
});

/**
 * Re-saving details without re-typing the passport: keeps the document already stored for this
 * passenger (the client only ever sees it masked). 422 DOCUMENT_REQUIRED when none is stored.
 */
export const keepDocumentSchema = z.object({ keepExisting: z.literal(true) });

const passengerRef = z.string().min(1).max(64);

export const passengerDetailsSchema = z
  .object({
    /** The offer passenger slot (offer.passengers[].ref) this person fills. */
    ref: passengerRef,
    type: z.enum(PASSENGER_TYPES),
    title: z.enum(PASSENGER_TITLES),
    gender: z.enum(GENDERS),
    givenName: personName,
    familyName: personName.nullish(),
    /** Passport shows a single name (mononym). */
    noFamilyName: z.boolean().default(false),
    dateOfBirth: isoDate,
    nationality: countryCode,
    document: z.union([passportSchema, keepDocumentSchema]).nullish(),
    /** Infants only: ref of the adult they travel with. */
    associatedAdultRef: passengerRef.nullish(),
  })
  .superRefine((p, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (!p.noFamilyName && !p.familyName) {
      issue('familyName', 'Required — or tick "no family name" if the passport shows only one name');
    }
    if (p.noFamilyName && p.familyName) issue('familyName', 'Leave empty when "no family name" is ticked');
    if (p.type === 'infant' && !p.associatedAdultRef) issue('associatedAdultRef', 'Choose the adult this infant travels with');
    if (p.type !== 'infant' && p.associatedAdultRef) issue('associatedAdultRef', 'Only infants travel with an adult');
    if (p.dateOfBirth > new Date().toISOString().slice(0, 10)) issue('dateOfBirth', 'Must not be in the future');
  });
export type PassengerDetails = z.output<typeof passengerDetailsSchema>;

export const contactSchema = z.object({
  title: z.enum(PASSENGER_TITLES),
  givenName: personName,
  familyName: personName.nullish(),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address')),
  phone: z
    .string()
    .trim()
    .overwrite((s) => s.replace(/[\s().-]/g, ''))
    .regex(/^\+[1-9]\d{6,14}$/, 'Use international format with country code, e.g. +14155552671'),
});
export type ContactDetails = z.output<typeof contactSchema>;

/** Client sends WHICH services, never amounts: prices always come from the supplier. */
export const serviceSelectionSchema = z.object({
  serviceId: z.string().min(1).max(512),
  quantity: z.number().int().min(1).max(9),
});

/** PUT /v1/bookings/:id/details — replaces all previous details and add-ons. */
export const updateBookingDetailsSchema = z
  .object({
    passengers: z.array(passengerDetailsSchema).min(1).max(MAX_BOOKING_PASSENGERS),
    contact: contactSchema,
    services: z.array(serviceSelectionSchema).max(100).default([]),
    /** Opt-in only: null (or omitted) = no insurance. */
    insurance: z.object({ quoteId: z.string().min(1).max(64) }).nullable().default(null),
  })
  .superRefine((body, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const refs = body.passengers.map((p) => p.ref);
    refs.forEach((ref, i) => {
      if (refs.indexOf(ref) !== i) issue(['passengers', i, 'ref'], 'Duplicate passenger');
    });
    const adults = new Set(body.passengers.filter((p) => p.type === 'adult').map((p) => p.ref));
    const linked = new Set<string>();
    body.passengers.forEach((p, i) => {
      if (p.type !== 'infant' || !p.associatedAdultRef) return;
      if (!adults.has(p.associatedAdultRef)) issue(['passengers', i, 'associatedAdultRef'], 'Must be an adult on this booking');
      else if (linked.has(p.associatedAdultRef)) issue(['passengers', i, 'associatedAdultRef'], 'Each adult can travel with one infant only');
      linked.add(p.associatedAdultRef);
    });
    const serviceIds = body.services.map((s) => s.serviceId);
    serviceIds.forEach((id, i) => {
      if (serviceIds.indexOf(id) !== i) issue(['services', i, 'serviceId'], 'Duplicate service');
    });
  });
export type UpdateBookingDetailsBody = z.output<typeof updateBookingDetailsSchema>;
export type UpdateBookingDetailsInput = z.input<typeof updateBookingDetailsSchema>;

// ---------------------------------------------------------------------------------------------
// Public response types

export interface BookingPrice {
  currency: string;
  /** Flight fare from the latest re-price. */
  fare: Money;
  /** Bags + seats. */
  ancillaries: Money;
  insurance: Money;
  total: Money;
}

export interface PublicBookingPassenger {
  ref: string;
  position: number;
  type: PassengerType;
  title: (typeof PASSENGER_TITLES)[number];
  gender: (typeof GENDERS)[number];
  givenName: string;
  familyName: string | null;
  dateOfBirth: string;
  nationality: string;
  /** The document number is never returned: only its last 3 characters, e.g. "*****567". */
  document: { type: 'passport'; numberMasked: string; issuingCountry: string; expiryDate: string } | null;
  associatedAdultRef: string | null;
}

export interface PublicBookingAncillary {
  type: 'bag' | 'seat' | 'insurance';
  passengerRef: string | null;
  segmentRef: string | null;
  serviceId: string | null;
  /** e.g. "1 × 23kg checked bag", "Seat 14C". */
  label: string;
  quantity: number;
  amount: Money;
}

export interface InsuranceQuote {
  quoteId: string;
  name: string;
  description: string;
  pricePerPassenger: Money;
  total: Money;
  /** Demo product: no real policy is issued. */
  demo: boolean;
}

/** Display data for an airport on the booking's itinerary. */
export interface BookingAirport {
  name: string;
  city: string | null;
  /** ISO 3166-1 alpha-2 */
  countryCode: string;
}

export interface PublicBooking {
  id: string;
  /** What the customer quotes, e.g. "K7MX2QPA". */
  reference: string;
  status: BookingStatus;
  supplier: SupplierName;
  /** Test inventory (mock / Duffel test mode). */
  demo: boolean;
  /** The offer as priced at the last re-price (draft creation or checkout). */
  offer: PublicFlightOffer;
  /** Every airport in `offer` we know, by IATA code (unknown codes are absent). */
  airports: Record<string, BookingAirport>;
  trip: {
    /** More than one country, or an airport we don't know (the safe side: passports are asked). */
    international: boolean;
  };
  /** Offer expiry: the booking must be confirmed before this (ISO 8601). */
  expiresAt: string;
  price: BookingPrice;
  contact: {
    title: (typeof PASSENGER_TITLES)[number];
    givenName: string;
    familyName: string | null;
    email: string;
    phone: string;
  } | null;
  passengers: PublicBookingPassenger[];
  ancillaries: PublicBookingAncillary[];
  insurance: {
    quotes: InsuranceQuote[];
    selectedQuoteId: string | null;
    policyNumber: string | null;
    demo: boolean;
  };
  /** Airline booking reference once CONFIRMED. */
  pnr: string | null;
  confirmedAt: string | null;
  failure: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingWarning {
  code: 'PASSPORT_EXPIRES_SOON';
  path: string;
  message: string;
}

/** 422/409/410 business errors from the bookings API (FARE_NO_LONGER_AVAILABLE also from flights). */
export type BookingErrorCode =
  | 'AGE_CATEGORY_MISMATCH'
  | 'PASSENGERS_MISMATCH'
  | 'NAME_TOO_LONG'
  | 'DOCUMENT_REQUIRED'
  | 'DOCUMENT_EXPIRED'
  | 'INVALID_SERVICE'
  | 'INSURANCE_QUOTE_INVALID'
  | 'DETAILS_INCOMPLETE'
  | 'PRICE_CHANGED'
  | 'SERVICE_UNAVAILABLE'
  | 'BOOKING_REJECTED'
  | 'ILLEGAL_STATE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BOOKING_EXPIRED'
  /** 410 (also from /flights/offers/:id): the fare can't be booked any more — search again. */
  | 'FARE_NO_LONGER_AVAILABLE'
  | 'SUPPLIER_ERROR';

export interface BookingIssue {
  code: BookingErrorCode;
  path: string;
  message: string;
}

export interface BookingErrorBody {
  statusCode: number;
  code: BookingErrorCode;
  message: string;
  issues?: BookingIssue[];
  /** PRICE_CHANGED */
  previousTotal?: Money;
  newTotal?: Money;
  /** SERVICE_UNAVAILABLE */
  serviceIds?: string[];
}

/** POST /v1/bookings → 201. The guest token is returned ONLY here: send it as X-Booking-Token. */
export interface CreateBookingResponse {
  data: PublicBooking;
  meta: { guestToken: string; priceChanged: boolean; previousTotal?: Money };
}

/** GET /v1/bookings/:id, POST …/checkout, POST …/confirm-demo (200 / 202 CONFIRMING). */
export interface BookingResponse {
  data: PublicBooking;
}

/** PUT /v1/bookings/:id/details */
export interface UpdateBookingDetailsResponse {
  data: PublicBooking;
  meta: { warnings: BookingWarning[] };
}

/**
 * Ancillaries as the API serves them: `identityDocumentRequired` is already DECIDED by the server
 * (the supplier's answer, or the international-trip rule when the supplier gives none).
 */
export type PublicAncillaries = Omit<Ancillaries, 'passengerRequirements'> & {
  passengerRequirements: { identityDocumentRequired: boolean; maxNameLength: number | null };
};

/** GET /v1/bookings/:id/ancillaries */
export interface AncillariesResponse {
  data: PublicAncillaries;
}

/** GET /v1/bookings/:id/seat-maps */
export interface SeatMapsResponse {
  data: SeatMap[];
}
