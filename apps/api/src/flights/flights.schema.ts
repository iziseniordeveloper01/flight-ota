import { z } from 'zod';

const MAX_DAYS_AHEAD = 361; // airlines publish schedules ~11–12 months out
const MAX_SEATED_PASSENGERS = 9;

const iata = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter IATA code');

// z.iso.date() checks the YYYY-MM-DD shape AND that the day exists (rejects 2026-02-30).
const isoDate = z.iso.date('Must be a date in YYYY-MM-DD format');

function utcDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export const searchFlightsSchema = z
  .object({
    origin: iata,
    destination: iata,
    departureDate: isoDate,
    returnDate: isoDate.optional(),
    adults: z.number().int().min(1).max(9).default(1),
    children: z.number().int().min(0).max(8).default(0),
    infants: z.number().int().min(0).max(9).default(0),
    cabin: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 code')
      .optional(),
  })
  .superRefine((body, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (body.origin === body.destination) issue('destination', 'Must differ from origin');

    // YYYY-MM-DD strings compare correctly as plain strings.
    // Timezone caveat: "today" is the UTC date. Just after midnight in e.g. India (UTC+5:30) the
    // local date is already tomorrow, so a same-day search can briefly be accepted/rejected a few
    // hours early or late. Fine for now; the precise rule is "today at the origin airport".
    const today = utcDate();
    const lastDay = utcDate(MAX_DAYS_AHEAD);
    if (body.departureDate < today) issue('departureDate', 'Must not be in the past');
    if (body.departureDate > lastDay) {
      issue('departureDate', `Must be within ${MAX_DAYS_AHEAD} days`);
    }
    if (body.returnDate !== undefined) {
      if (body.returnDate < body.departureDate) {
        issue('returnDate', 'Must be on or after departureDate');
      }
      if (body.returnDate > lastDay) issue('returnDate', `Must be within ${MAX_DAYS_AHEAD} days`);
    }

    // Lap infants travel on an adult's lap: at most one per adult.
    if (body.infants > body.adults) issue('infants', 'Cannot exceed the number of adults');
    if (body.adults + body.children > MAX_SEATED_PASSENGERS) {
      issue('children', `Adults + children cannot exceed ${MAX_SEATED_PASSENGERS}`);
    }
  });

export type SearchFlightsBody = z.infer<typeof searchFlightsSchema>;

// Our public offer ids: `${supplier}:${supplierOfferId}`.
export const offerIdSchema = z
  .string()
  .regex(/^(mock|duffel|tbo):[A-Za-z0-9_-]{1,128}$/, 'Malformed offer id');
