import type {
  Ancillaries,
  BagOption,
  CreateOrderInput,
  OrderPassenger,
  OrderResult,
  SeatMap,
  SeatMapElement,
} from '../types.js';
import type {
  CreateOrder,
  CreateOrderPassenger,
  Offer,
  OfferAvailableService,
  Order,
  SeatMap as DuffelSeatMap,
  SeatMapCabinRow,
  SeatMapCabinRowSectionElement,
} from './duffel.types.js';

// Duffel accepts 1–20 characters per given/family name (Latin letters, space, - and ').
export const DUFFEL_MAX_NAME_LENGTH = 20;

// Key under which we store our idempotency key in order.metadata, so a lost response can be found.
export const BOOKING_METADATA_KEY = 'ota_booking_id';

export function toAncillaries(offer: Offer, seatMaps: DuffelSeatMap[]): Ancillaries {
  return {
    bags: offer.available_services.flatMap(toBag),
    seatsAvailable: seatMaps.some((m) => toSeatMap(m).cabins.some(hasAvailableSeat)),
    passengerRequirements: {
      identityDocumentRequired: offer.passenger_identity_documents_required,
      maxNameLength: DUFFEL_MAX_NAME_LENGTH,
    },
  };
}

// Only baggage; 'cancel_for_any_reason' is an insurance-like product we don't sell.
function toBag(service: OfferAvailableService): BagOption[] {
  if (service.type !== 'baggage') return [];
  const kg = service.metadata.maximum_weight_kg ?? undefined;
  const kind = service.metadata.type === 'checked' ? 'checked bag' : 'cabin bag';
  return [
    {
      serviceId: service.id,
      // Baggage services always apply to exactly one passenger.
      passengerRef: service.passenger_ids[0],
      segmentRefs: service.segment_ids,
      label: kg ? `${kg}kg ${kind}` : kind,
      weightKg: kg,
      maxQuantity: service.maximum_quantity,
      price: { amount: service.total_amount, currency: service.total_currency },
    },
  ];
}

function hasAvailableSeat(cabin: SeatMap['cabins'][number]): boolean {
  return cabin.rows.some((r) => r.sections.some((s) => s.elements.some((e) => e.type === 'seat' && e.available)));
}

export function toSeatMap(map: DuffelSeatMap): SeatMap {
  return {
    segmentRef: map.segment_id,
    cabins: map.cabins.map((cabin) => ({
      deck: cabin.deck,
      rows: cabin.rows.map((row) => ({
        number: rowNumber(row),
        sections: row.sections.map((section) => ({ elements: section.elements.map(toElement) })),
      })),
    })),
  };
}

// Duffel rows carry no number; it's the numeric prefix of any seat designator ("14C" → 14).
function rowNumber(row: SeatMapCabinRow): number | null {
  for (const section of row.sections) {
    for (const el of section.elements) {
      if ('designator' in el) {
        const n = /^\d+/.exec(el.designator);
        if (n) return Number(n[0]);
      }
    }
  }
  return null;
}

function toElement(el: SeatMapCabinRowSectionElement): SeatMapElement {
  switch (el.type) {
    case 'seat':
    case 'restricted_seat_general': {
      // An empty available_services list means nobody can book this seat.
      const services = el.available_services.map((s) => ({
        passengerRef: s.passenger_id,
        serviceId: s.id,
        price: { amount: s.total_amount, currency: s.total_currency },
      }));
      return {
        type: 'seat',
        designator: el.designator,
        available: services.length > 0,
        ...(el.name ? { name: el.name } : {}),
        ...(el.disclosures.length ? { disclosures: el.disclosures } : {}),
        services,
      };
    }
    case 'exit_row':
      return { type: 'exit' };
    case 'lavatory':
    case 'galley':
    case 'closet':
    case 'stairs':
    case 'bassinet':
      return { type: 'facility', kind: el.type };
    default:
      // 'empty' and any element type Duffel adds later: keep the grid aligned.
      return { type: 'gap' };
  }
}

/**
 * Duffel requires a family name. For mononyms (no family name) Duffel's convention is to repeat
 * the given name. Each supplier has its own convention (TBO may differ, e.g. "FNU"), so this stays
 * inside the Duffel adapter — the API always passes familyName: null.
 */
export function duffelFamilyName(p: Pick<OrderPassenger, 'givenName' | 'familyName'>): string {
  return p.familyName ?? p.givenName;
}

export function toCreateOrder(input: CreateOrderInput): CreateOrder {
  // Duffel links infants from the adult's side.
  const infantByAdult = new Map(
    input.passengers.filter((p) => p.associatedAdultRef).map((p) => [p.associatedAdultRef!, p.ref]),
  );
  const passengers = input.passengers.map(
    (p): CreateOrderPassenger => ({
      id: p.ref,
      title: p.title,
      gender: p.gender,
      given_name: p.givenName,
      family_name: duffelFamilyName(p),
      born_on: p.dateOfBirth,
      // Duffel wants contact details per passenger; we have one booking contact.
      email: input.contact.email,
      phone_number: input.contact.phone,
      ...(infantByAdult.has(p.ref) ? { infant_passenger_id: infantByAdult.get(p.ref) } : {}),
      ...(p.document
        ? {
            identity_documents: [
              {
                type: 'passport',
                unique_identifier: p.document.number,
                issuing_country_code: p.document.issuingCountry,
                expires_on: p.document.expiryDate,
              },
            ],
          }
        : {}),
    }),
  );
  return {
    // Instant = book and pay in one call. Hold orders come with real payments (Step 8).
    type: 'instant',
    selected_offers: [input.supplierOfferId],
    passengers,
    services: input.services.map((s) => ({ id: s.serviceId, quantity: s.quantity })),
    // Test mode: Duffel balance is unlimited. Amount must equal offer total + services.
    payments: [{ type: 'balance', amount: input.expectedTotal.amount, currency: input.expectedTotal.currency }],
    metadata: { [BOOKING_METADATA_KEY]: input.idempotencyKey },
  };
}

export function toOrderResult(order: Order): OrderResult {
  const pnr = order.booking_reference || null;
  return {
    supplierOrderId: order.id,
    pnr,
    status: pnr ? 'confirmed' : 'pending',
    total: { amount: order.total_amount, currency: order.total_currency },
  };
}
