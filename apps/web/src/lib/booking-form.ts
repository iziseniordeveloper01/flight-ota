import {
  ageOnDate,
  passengerTypeForAge,
  updateBookingDetailsSchema,
  type PassengerType,
  type PublicBooking,
  type UpdateBookingDetailsBody,
  type UpdateBookingDetailsInput,
} from '@ota/contracts';
import { z } from 'zod';
import { messages } from './messages';

// Step-1 form. Its values have the SAME shape and paths as the API body (passengers.0.dateOfBirth,
// contact.phone…), so the shared contract schema validates it and server issues map straight back
// onto fields. Date selects and the phone field write ISO / E.164 strings into these values.

export type Title = 'mr' | 'mrs' | 'ms' | 'miss';
export type PassportValue = { type: 'passport'; number: string; issuingCountry: string; expiryDate: string };
export type DocumentValue = PassportValue | { keepExisting: true } | null;

export interface PassengerFormValue {
  ref: string;
  type: PassengerType;
  title: Title | '';
  gender: 'm' | 'f' | '';
  givenName: string;
  familyName: string;
  noFamilyName: boolean;
  dateOfBirth: string;
  nationality: string;
  document: DocumentValue;
  associatedAdultRef: string | null;
}

export interface BookingFormValues {
  passengers: PassengerFormValue[];
  contact: { title: Title | ''; givenName: string; familyName: string; email: string; phone: string };
}

export interface FormContext {
  /** Local date of the last flight: airlines apply age rules on it. */
  lastFlightDate: string;
  /** Decided by the server (ancillaries.passengerRequirements). */
  documentRequired: boolean;
  maxNameLength: number | null;
}

export const emptyPassport = (): PassportValue => ({ type: 'passport', number: '', issuingCountry: '', expiryDate: '' });

/** Adults: Mr/Mrs/Ms/Miss. Children and infants: Mr (boys) / Miss (girls). */
export function titlesFor(type: PassengerType): Title[] {
  return type === 'adult' ? ['mr', 'mrs', 'ms', 'miss'] : ['mr', 'miss'];
}

/** Pre-fill gender from the title (still editable). */
export const genderForTitle = (title: Title): 'm' | 'f' => (title === 'mr' ? 'm' : 'f');

/** The age category mismatch for a complete date of birth, or null when it fits the booked type. */
export function ageCategoryError(
  dateOfBirth: string,
  type: PassengerType,
  lastFlight: string,
): { age: number; actual: PassengerType } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const age = ageOnDate(dateOfBirth, lastFlight);
  const actual = passengerTypeForAge(age);
  return actual === type ? null : { age, actual };
}

const typeWord = (t: PassengerType) => messages.passengerType[t].toLowerCase();

/** Form values → the API body shape ('' family names → null, links only for infants). */
function normalize(values: BookingFormValues): unknown {
  return {
    passengers: values.passengers.map((p) => ({
      ...p,
      familyName: p.noFamilyName || !p.familyName?.trim() ? null : p.familyName,
      associatedAdultRef: p.type === 'infant' ? (p.associatedAdultRef ?? null) : null,
    })),
    contact: { ...values.contact, familyName: values.contact.familyName?.trim() ? values.contact.familyName : null },
  };
}

/** The contract schema + the rules that depend on this booking (same rules the API enforces). */
export function bookingFormSchema(ctx: FormContext) {
  const rules = updateBookingDetailsSchema.superRefine((body, issueCtx) => {
    const issue = (path: (string | number)[], message: string) => issueCtx.addIssue({ code: 'custom', path, message });
    body.passengers.forEach((p, i) => {
      const mismatch = ageCategoryError(p.dateOfBirth, p.type, ctx.lastFlightDate);
      if (mismatch) issue(['passengers', i, 'dateOfBirth'], messages.booking.ageMismatch(mismatch.age, typeWord(mismatch.actual), typeWord(p.type)));
      if (ctx.maxNameLength !== null) {
        for (const field of ['givenName', 'familyName'] as const) {
          if ((p[field]?.length ?? 0) > ctx.maxNameLength) issue(['passengers', i, field], messages.booking.nameTooLong(ctx.maxNameLength));
        }
      }
      if (ctx.documentRequired && !p.document) issue(['passengers', i, 'document', 'number'], messages.booking.passportRequiredNote);
      if (p.document && 'expiryDate' in p.document && p.document.expiryDate <= ctx.lastFlightDate) {
        issue(['passengers', i, 'document', 'expiryDate'], messages.booking.passportExpired);
      }
    });
  });
  // Input: the form values; output: the parsed API body (what onValid receives).
  return z.preprocess((v) => normalize(v as BookingFormValues), rules) as unknown as z.ZodType<ValidBookingForm, BookingFormValues>;
}

export type ValidBookingForm = UpdateBookingDetailsBody;

/** Initial values: what is saved on the booking (after a refresh), else empty slots in offer order. */
export function defaultFormValues(booking: PublicBooking, ctx: Pick<FormContext, 'documentRequired'>): BookingFormValues {
  const saved = new Map(booking.passengers.map((p) => [p.ref, p]));
  return {
    passengers: booking.offer.passengers.map((slot) => {
      const p = saved.get(slot.ref);
      const document: DocumentValue = p?.document ? { keepExisting: true } : ctx.documentRequired ? emptyPassport() : null;
      return {
        ref: slot.ref,
        type: slot.type,
        title: p?.title ?? '',
        gender: p?.gender ?? '',
        givenName: p?.givenName ?? '',
        familyName: p?.familyName ?? '',
        noFamilyName: p ? p.familyName === null : false,
        dateOfBirth: p?.dateOfBirth ?? '',
        nationality: p?.nationality ?? '',
        document,
        associatedAdultRef: p?.associatedAdultRef ?? null,
      };
    }),
    contact: {
      title: booking.contact?.title ?? '',
      givenName: booking.contact?.givenName ?? '',
      familyName: booking.contact?.familyName ?? '',
      email: booking.contact?.email ?? '',
      phone: booking.contact?.phone ?? '',
    },
  };
}

/** Validated form + selected extras → PUT /details body. Amounts are never sent, only service ids. */
export function toDetailsBody(
  form: ValidBookingForm,
  serviceIds: string[],
  insuranceQuoteId: string | null,
): UpdateBookingDetailsInput {
  return {
    passengers: form.passengers,
    contact: form.contact,
    services: serviceIds.map((serviceId) => ({ serviceId, quantity: 1 })),
    insurance: insuranceQuoteId ? { quoteId: insuranceQuoteId } : null,
  };
}
