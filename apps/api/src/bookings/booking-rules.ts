import {
  ageOnDate,
  passengerTypeForAge,
  PASSPORT_WARNING_MONTHS,
  type BookingIssue,
  type BookingPrice,
  type BookingWarning,
  type PassengerDetails,
  type PublicFlightOffer,
} from '@ota/contracts';
import { multiplyMoney, sumMoney, type Ancillaries, type Money, type OfferPassenger, type SeatMap } from '@ota/suppliers';

// Pure booking rules (no DB, no HTTP) so every edge case is unit-testable.

/** Local date (YYYY-MM-DD) of the last flight's departure: the day airlines apply age rules. */
export function lastFlightDate(offer: Pick<PublicFlightOffer, 'slices'>): string {
  const lastSlice = offer.slices[offer.slices.length - 1];
  const lastSegment = lastSlice.segments[lastSlice.segments.length - 1];
  // Airport-local "YYYY-MM-DDTHH:mm:ss": the date is just the first 10 chars (no Date parsing).
  return lastSegment.departureAt.slice(0, 10);
}

/** YYYY-MM-DD + n months, clamping the day (31 Aug + 6 months → 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(Math.min(d, lastDay))}`;
}

export interface PassengerRulesContext {
  /** The offer's passenger slots — the booking must fill exactly these. */
  slots: OfferPassenger[];
  lastFlightDate: string;
  documentRequired: boolean;
  /** Supplier's name length limit (Duffel: 20); null = only our own 50-char schema limit. */
  maxNameLength: number | null;
}

export function checkPassengers(
  passengers: PassengerDetails[],
  ctx: PassengerRulesContext,
): { issues: BookingIssue[]; warnings: BookingWarning[] } {
  const issues: BookingIssue[] = [];
  const warnings: BookingWarning[] = [];

  // The fare was priced for these exact slots; any other mix needs a new search.
  const slotType = new Map(ctx.slots.map((s) => [s.ref, s.type]));
  const matches =
    passengers.length === ctx.slots.length && passengers.every((p) => slotType.get(p.ref) === p.type);
  if (!matches) {
    issues.push({
      code: 'PASSENGERS_MISMATCH',
      path: 'passengers',
      message: 'Passengers must match the searched adults, children and infants. Please search again.',
    });
    return { issues, warnings };
  }

  const passportWarnBefore = addMonths(ctx.lastFlightDate, PASSPORT_WARNING_MONTHS);
  passengers.forEach((p, i) => {
    const at = (field: string) => `passengers.${i}.${field}`;

    const age = ageOnDate(p.dateOfBirth, ctx.lastFlightDate);
    const actual = passengerTypeForAge(age);
    if (actual !== p.type) {
      issues.push({
        code: 'AGE_CATEGORY_MISMATCH',
        path: at('dateOfBirth'),
        message: `On ${ctx.lastFlightDate} this passenger will be ${age} (${actual}), but the fare is for a ${p.type}. Please search again with the right passengers.`,
      });
    }

    if (ctx.maxNameLength !== null) {
      for (const field of ['givenName', 'familyName'] as const) {
        if ((p[field]?.length ?? 0) > ctx.maxNameLength) {
          issues.push({
            code: 'NAME_TOO_LONG',
            path: at(field),
            message: `The airline accepts at most ${ctx.maxNameLength} characters per name.`,
          });
        }
      }
    }

    if (ctx.documentRequired && !p.document) {
      issues.push({ code: 'DOCUMENT_REQUIRED', path: at('document'), message: 'Passport details are required for this trip.' });
    }
    if (p.document) {
      if (p.document.expiryDate <= ctx.lastFlightDate) {
        issues.push({
          code: 'DOCUMENT_EXPIRED',
          path: at('document.expiryDate'),
          message: 'The passport must still be valid after the last flight.',
        });
      } else if (p.document.expiryDate < passportWarnBefore) {
        warnings.push({
          code: 'PASSPORT_EXPIRES_SOON',
          path: at('document.expiryDate'),
          message: `The passport expires within ${PASSPORT_WARNING_MONTHS} months of the last flight. Many countries refuse entry — please check before you travel.`,
        });
      }
    }
  });
  return { issues, warnings };
}

export interface CatalogueEntry {
  kind: 'bag' | 'seat';
  serviceId: string;
  passengerRef: string;
  /** Seats: the one segment. Bags may span several, so null. */
  segmentRef: string | null;
  designator: string | null;
  label: string;
  unitPrice: Money;
  maxQuantity: number;
}

/** Every bookable add-on by service id — the only source of add-on prices. */
export function buildCatalogue(ancillaries: Ancillaries | null, seatMaps: SeatMap[] | null): Map<string, CatalogueEntry> {
  const catalogue = new Map<string, CatalogueEntry>();
  for (const bag of ancillaries?.bags ?? []) {
    catalogue.set(bag.serviceId, {
      kind: 'bag',
      serviceId: bag.serviceId,
      passengerRef: bag.passengerRef,
      segmentRef: null,
      designator: null,
      label: bag.label,
      unitPrice: bag.price,
      maxQuantity: bag.maxQuantity,
    });
  }
  for (const map of seatMaps ?? []) {
    for (const row of map.cabins.flatMap((c) => c.rows)) {
      for (const el of row.sections.flatMap((s) => s.elements)) {
        if (el.type !== 'seat') continue;
        for (const svc of el.services) {
          catalogue.set(svc.serviceId, {
            kind: 'seat',
            serviceId: svc.serviceId,
            passengerRef: svc.passengerRef,
            segmentRef: map.segmentRef,
            designator: el.designator,
            label: `Seat ${el.designator}`,
            unitPrice: svc.price,
            maxQuantity: 1,
          });
        }
      }
    }
  }
  return catalogue;
}

export interface PricedService {
  entry: CatalogueEntry;
  quantity: number;
  label: string;
  amount: Money;
}

export function priceServices(
  selection: Array<{ serviceId: string; quantity: number }>,
  catalogue: Map<string, CatalogueEntry>,
  passengerRefs: Set<string>,
): { lines: PricedService[]; issues: BookingIssue[] } {
  const lines: PricedService[] = [];
  const issues: BookingIssue[] = [];
  const seatPerPassenger = new Set<string>();
  const seatTaken = new Set<string>();
  selection.forEach(({ serviceId, quantity }, i) => {
    const entry = catalogue.get(serviceId);
    const invalid = (field: string, message: string) =>
      issues.push({ code: 'INVALID_SERVICE', path: `services.${i}.${field}`, message });
    if (!entry || !passengerRefs.has(entry.passengerRef)) return invalid('serviceId', 'This add-on is not available for this booking.');
    if (quantity > entry.maxQuantity) return invalid('quantity', `At most ${entry.maxQuantity} of this add-on.`);
    if (entry.kind === 'seat') {
      const paxKey = `${entry.passengerRef}|${entry.segmentRef}`;
      const seatKey = `${entry.segmentRef}|${entry.designator}`;
      if (seatPerPassenger.has(paxKey)) return invalid('serviceId', 'Only one seat per passenger per flight.');
      if (seatTaken.has(seatKey)) return invalid('serviceId', 'This seat is already selected for another passenger.');
      seatPerPassenger.add(paxKey);
      seatTaken.add(seatKey);
    }
    lines.push({
      entry,
      quantity,
      label: entry.kind === 'bag' ? `${quantity} × ${entry.label}` : entry.label,
      amount: multiplyMoney(entry.unitPrice, quantity),
    });
  });
  return { lines, issues };
}

/** Fare + add-ons + insurance, decimal-exact in the booking currency (throws on a currency mismatch). */
export function bookingTotals(fare: Money, addOns: Money[], insurance: Money | null): BookingPrice {
  const { currency } = fare;
  const ancillaries = sumMoney(addOns, currency);
  const insuranceAmount = insurance ?? sumMoney([], currency);
  return {
    currency,
    fare,
    ancillaries,
    insurance: insuranceAmount,
    total: sumMoney([fare, ancillaries, insuranceAmount], currency),
  };
}
