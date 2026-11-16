import { randomBytes } from 'node:crypto';
import type { SupplierAdapter } from '../adapter.js';
import { SupplierError } from '../errors.js';
import { addMinutesLocal } from '../local-time.js';
import {
  compareMoney,
  currencyDigits,
  moneyFromMinor,
  multiplyMoney,
  priceChange,
  sumMoney,
  toMinor,
} from '../money.js';
import type {
  Ancillaries,
  BaggageAllowance,
  BagOption,
  CabinClass,
  CallOptions,
  Carrier,
  CreateOrderInput,
  FlightOffer,
  Money,
  OfferPassenger,
  OrderLookup,
  OrderResult,
  PassengerPrice,
  PriceOptions,
  PricedOffer,
  SearchRequest,
  SeatMap,
  SeatMapElement,
  SeatMapRow,
  Segment,
  Slice,
} from '../types.js';

// Offline, deterministic supplier for development and tests. Same request → same flights, fares
// and prices (only expiresAt moves with the clock), so offerFingerprint() is stable across searches.
// No network, no Math.random in the generated data.
// Stateless: each supplierOfferId encodes the search request + offer index, so price() regenerates
// the offer on any instance — searches cached in Redis stay selectable across API restarts.
// Bags, seats and orders are derived from the offer id too; service ids are deterministic strings
// and createOrder() regenerates the catalogue to look them up (no stored state).
//
// Like Duffel, every search is a new "offer request": ids carry a random per-search nonce, and only
// ONE order may be created per offer request (a second booking with another idempotency key →
// OFFER_EXPIRED, Duffel's offer_request_already_booked). That rule needs memory, which lives in the
// instance (lost on restart, not shared between API instances — enough for dev and tests).

const OFFER_TTL_MS = 20 * 60_000;
const OFFERS_PER_SEARCH = 10;

// Scenario routes mirror Duffel's test-mode behaviours so error handling is testable offline.
const NO_OFFERS_ROUTE = 'PVD-RAI';
const TIMEOUT_ROUTE = 'STN-LHR';
const PRICE_CHANGE_ROUTE = 'LHR-STN';
const PRICE_CHANGE_PCT = 12n;
// Late-booking route: once departure is ≤ LATE_DAYS away (by the mock clock), price() adds
// LATE_PCT to the fare and the 23kg bag sells out. Tests move the injected clock to trigger it.
const LATE_ROUTE = 'LGW-LHR';
const LATE_DAYS = 14;
const LATE_PCT = 10n;

// Order scenarios by passenger family name (upper-cased). TIMEOUT applies to the LEAD passenger:
// createOrder() times out but the order "exists", so retrieveOrder() finds it by lookup.
const FAIL_NAME = 'FAIL';
const PRICE_CHANGE_NAME = 'PRICECHANGE';
const TIMEOUT_NAME = 'TIMEOUT';

// Ancillary prices in cents (rescaled to the currency's minor unit like fares).
const BAGS = [
  { kg: 15, cents: 2_000n, max: 2 },
  { kg: 23, cents: 3_500n, max: 2 },
] as const;
// Segments longer than this fly a wide-body (3-4-3 seat map, wide-body aircraft name).
const WIDE_BODY_MINUTES = 6 * 60;
interface CabinLayout {
  rows: number;
  letters: string[][];
  exitRows: Set<number>;
  /** Rows 1..legroomUntil are "Extra legroom"; then cheap until cheapUntil; the rest free. */
  legroomUntil: number;
  cheapUntil: number;
}
const NARROW_BODY: CabinLayout = { rows: 30, letters: [['A', 'B', 'C'], ['D', 'E', 'F']], exitRows: new Set([12, 13]), legroomUntil: 4, cheapUntil: 11 };
// No "I" column: airlines skip it (looks like a 1).
const WIDE_BODY: CabinLayout = { rows: 42, letters: [['A', 'B', 'C'], ['D', 'E', 'F', 'G'], ['H', 'J', 'K']], exitRows: new Set([22]), legroomUntil: 5, cheapUntil: 15 };
// Offer requests that already have an order (nonce → idempotency key); bounded.
const MAX_BOOKED_REQUESTS = 10_000;
const PNR_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

interface MockFare {
  carrier: Carrier;
  fareBrand: string;
  baggage: BaggageAllowance;
  refundable: boolean | null;
  changeable: boolean | null;
  requiresInstantPayment: boolean;
}

const FARES: MockFare[] = [
  {
    carrier: { code: 'M1', name: 'Mock Air One' },
    fareBrand: 'Classic',
    baggage: { checkedPieces: 1, checkedWeightKg: 23, cabinPieces: 1 },
    refundable: false,
    changeable: true,
    requiresInstantPayment: false,
  },
  {
    carrier: { code: 'M2', name: 'Mock Air Two' },
    fareBrand: 'Light',
    baggage: { checkedPieces: 0, cabinPieces: 1 },
    refundable: false,
    changeable: false,
    // Behaves like a low-cost carrier: no holds, pay at booking.
    requiresInstantPayment: true,
  },
  {
    carrier: { code: 'M3', name: 'Mock Air Three' },
    fareBrand: 'Flex',
    baggage: { checkedPieces: 2, checkedWeightKg: 23, cabinPieces: 1 },
    refundable: true,
    changeable: true,
    requiresInstantPayment: false,
  },
];

const HUBS = ['DXB', 'FRA', 'IST', 'DOH', 'AMS'];
const NARROW_AIRCRAFT = ['Airbus A320neo', 'Boeing 737-800'];
const WIDE_AIRCRAFT = ['Airbus A350-900', 'Boeing 787-9'];
const CABIN_MULTIPLIER: Record<CabinClass, bigint> = {
  economy: 1n,
  premium_economy: 2n,
  business: 4n,
  first: 7n,
};
// Integer percentages of the adult fare (no floats anywhere in pricing).
const CHILD_PCT = 75n;
const INFANT_PCT = 10n;
const TAX_PCT = 18n;

// FNV-1a: tiny, stable string hash used to seed the PRNG.
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 PRNG: deterministic for a given seed, good enough for fake data.
function prng(seed: number): (maxExclusive: number) => number {
  let a = seed;
  return (maxExclusive) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * maxExclusive);
  };
}

interface GeneratedOffer {
  offer: FlightOffer;
  // Per-person fare in "cents" (1/100 of the currency major unit) — repricing recomputes from these.
  unitBaseCents: bigint;
  unitTaxCents: bigint;
}

export interface MockSupplierOptions {
  /** Injectable clock for tests. */
  now?: () => number;
}

export class MockSupplier implements SupplierAdapter {
  readonly name = 'mock' as const;
  private readonly now: () => number;
  private readonly bookedRequests = new Map<string, string>();

  constructor(options: MockSupplierOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  async search(req: SearchRequest, opts: CallOptions = {}): Promise<FlightOffer[]> {
    this.throwIfAborted(opts);
    const route = `${req.origin}-${req.destination}`;
    if (route === TIMEOUT_ROUTE) {
      throw new SupplierError('TIMEOUT', this.name, 'Mock supplier timed out (scenario route)');
    }
    if (route === NO_OFFERS_ROUTE) return [];
    const nonce = randomBytes(6).toString('base64url');
    return this.generate(req, nonce).map(({ offer }) => offer);
  }

  async price(supplierOfferId: string, opts: PriceOptions = {}): Promise<PricedOffer> {
    this.throwIfAborted(opts);
    const decoded = decodeOfferId(supplierOfferId);
    if (!decoded) {
      throw new SupplierError('OFFER_NOT_FOUND', this.name, 'Offer not found');
    }
    const { req, idx, nonce } = decoded;
    // UTC date, same rule as the search date bounds in @ota/contracts.
    if (req.departureDate < new Date(this.now()).toISOString().slice(0, 10)) {
      throw new SupplierError('OFFER_EXPIRED', this.name, 'Offer has expired (departure date passed)');
    }

    const generated = this.generate(req, nonce)[idx];
    const { offer, unitBaseCents } = generated;
    let { unitTaxCents } = generated;
    if (`${req.origin}-${req.destination}` === PRICE_CHANGE_ROUTE) {
      // Scenario: the airline raised the fare since search (surcharge lands in taxes).
      unitTaxCents += (unitBaseCents * PRICE_CHANGE_PCT) / 100n;
    }
    if (this.isLate(req)) unitTaxCents += (unitBaseCents * LATE_PCT) / 100n;
    const latest: FlightOffer = { ...offer, price: buildPrice(req, unitBaseCents, unitTaxCents) };
    try {
      return { ...latest, ...priceChange(opts.previousTotal ?? offer.price.total, latest.price.total) };
    } catch (err) {
      // Currency differs from previousTotal: not comparable. Same code as DuffelAdapter.
      throw new SupplierError('UPSTREAM_ERROR', this.name, (err as Error).message, { cause: err });
    }
  }

  async getAncillaries(supplierOfferId: string, opts: CallOptions = {}): Promise<Ancillaries> {
    const offer = await this.price(supplierOfferId, opts);
    return {
      bags: this.bags(offer),
      seatsAvailable: true,
      // Like TBO, the mock doesn't say whether documents are needed: the caller decides.
      passengerRequirements: { identityDocumentRequired: null, maxNameLength: null },
    };
  }

  async getSeatMaps(supplierOfferId: string, opts: CallOptions = {}): Promise<SeatMap[]> {
    const offer = await this.price(supplierOfferId, opts);
    return offer.slices.flatMap((s) => s.segments).map((seg) => this.seatMap(offer, seg.ref));
  }

  async createOrder(input: CreateOrderInput, opts: CallOptions = {}): Promise<OrderResult> {
    const offer = await this.price(input.supplierOfferId, opts);

    const slots = new Map(offer.passengers.map((p) => [p.ref, p.type]));
    const refs = new Set(input.passengers.map((p) => p.ref));
    if (refs.size !== slots.size || input.passengers.some((p) => slots.get(p.ref) !== p.type)) {
      throw new SupplierError('INVALID_REQUEST', this.name, 'Passengers do not match the offer');
    }
    this.claimOfferRequest(input);
    const names = input.passengers.map((p) => (p.familyName ?? '').toUpperCase());
    if (names.includes(FAIL_NAME)) {
      throw new SupplierError('UPSTREAM_ERROR', this.name, 'Mock airline rejected the order (scenario)');
    }
    if (names[0] === TIMEOUT_NAME) {
      throw new SupplierError('TIMEOUT', this.name, 'Mock order timed out (scenario; the order exists)');
    }

    const catalogue = this.serviceCatalogue(offer);
    const lines: Money[] = [offer.price.total];
    for (const { serviceId, quantity } of input.services) {
      const service = catalogue.get(serviceId);
      if (!service || quantity < 1 || quantity > service.max) {
        throw new SupplierError('INVALID_REQUEST', this.name, 'Unknown or unavailable service');
      }
      lines.push(multiplyMoney(service.price, quantity));
    }
    const currency = offer.price.total.currency;
    let total = sumMoney(lines, currency);
    if (names.includes(PRICE_CHANGE_NAME)) {
      const minor = toMinor(total.amount, currencyDigits(currency));
      total = moneyFromMinor(minor + (minor * PRICE_CHANGE_PCT) / 100n, currency);
    }
    if (input.expectedTotal.currency !== currency || compareMoney(total, input.expectedTotal) !== 0) {
      throw new SupplierError('PRICE_CHANGED', this.name, 'Order total differs from the expected total', {
        newTotal: total,
      });
    }
    return orderResult(input.idempotencyKey, total);
  }

  async retrieveOrder(lookup: OrderLookup, opts: CallOptions = {}): Promise<OrderResult | null> {
    this.throwIfAborted(opts);
    if (lookup.supplierOrderId) return decodeOrderId(lookup.supplierOrderId);
    // Only the TIMEOUT scenario leaves an order we didn't get a response for.
    return lookup.leadPassenger.familyName?.toUpperCase() === TIMEOUT_NAME
      ? orderResult(lookup.idempotencyKey, lookup.expectedTotal)
      : null;
  }

  // One order per offer request (search), like Duffel. The same idempotency key may retry (the
  // mock's orders are derived from it); any other key fails, even if the first attempt failed.
  private claimOfferRequest(input: CreateOrderInput): void {
    const nonce = decodeOfferId(input.supplierOfferId)?.nonce;
    if (!nonce) return; // ids from before nonces existed
    const owner = this.bookedRequests.get(nonce);
    if (owner !== undefined && owner !== input.idempotencyKey) {
      throw new SupplierError('OFFER_EXPIRED', this.name, 'Offer request already booked (one order per search)');
    }
    if (owner === undefined) {
      if (this.bookedRequests.size >= MAX_BOOKED_REQUESTS) {
        this.bookedRequests.delete(this.bookedRequests.keys().next().value!);
      }
      this.bookedRequests.set(nonce, input.idempotencyKey);
    }
  }

  private isLate(req: SearchRequest): boolean {
    if (`${req.origin}-${req.destination}` !== LATE_ROUTE) return false;
    const today = new Date(this.now()).toISOString().slice(0, 10);
    return (Date.parse(`${req.departureDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000 <= LATE_DAYS;
  }

  // 15kg + 23kg per seated passenger per slice; infants get no bag allowance to buy.
  private bags(offer: FlightOffer): BagOption[] {
    const currency = offer.price.total.currency;
    const key = offerKey(offer.supplierOfferId);
    const late = this.isLate(decodeOfferId(offer.supplierOfferId)!.req);
    return offer.passengers
      .filter((p) => p.type !== 'infant')
      .flatMap((p) =>
        offer.slices.flatMap((slice, sliceIdx) =>
          BAGS.filter((b) => !(late && b.kg === 23)).map(
            (b): BagOption => ({
              serviceId: `bag:${key}:${p.ref}:${sliceIdx}:${b.kg}`,
              passengerRef: p.ref,
              segmentRefs: slice.segments.map((s) => s.ref),
              label: `${b.kg}kg checked bag`,
              weightKg: b.kg,
              maxQuantity: b.max,
              price: moneyFromMinor(scaleCents(b.cents, currency), currency),
            }),
          ),
        ),
      );
  }

  // Narrow-body: rows 1–30, ABC|DEF, extra legroom 1–4, exit rows 12–13, cheap 5–11.
  // Wide-body (segment > 6h): rows 1–42, ABC|DEFG|HJK, extra legroom 1–5, exit row 22, cheap 6–15.
  // Extra legroom and exit rows are paid (exit rows adults only), the rest free; ~20% of seats
  // taken (hash-based, so stable per offer+segment).
  private seatMap(offer: FlightOffer, segmentRef: string): SeatMap {
    const currency = offer.price.total.currency;
    const key = offerKey(offer.supplierOfferId);
    const seated = offer.passengers.filter((p) => p.type !== 'infant');
    const segment = offer.slices.flatMap((s) => s.segments).find((s) => s.ref === segmentRef);
    const layout = segment && isWideBody(segment.durationMinutes) ? WIDE_BODY : NARROW_BODY;
    const firstExit = Math.min(...layout.exitRows);
    const facilities: SeatMapElement[] = [{ type: 'facility', kind: 'galley' }, { type: 'facility', kind: 'lavatory' }];
    const rows: SeatMapRow[] = [
      { number: null, sections: layout.letters.map((_, i) => ({ elements: [facilities[i % 2]] })) },
    ];
    for (let row = 1; row <= layout.rows; row++) {
      if (row === firstExit) {
        rows.push({ number: null, sections: layout.letters.map(() => ({ elements: [{ type: 'exit' }] })) });
      }
      const exit = layout.exitRows.has(row);
      const [name, cents] =
        row <= layout.legroomUntil ? ['Extra legroom', 2_500n] : exit ? ['Exit row', 3_000n] : row <= layout.cheapUntil ? ['Standard', 800n] : ['Standard', 0n];
      const price = moneyFromMinor(scaleCents(cents, currency), currency);
      rows.push({
        number: row,
        sections: layout.letters.map((letters) => ({
          elements: letters.map((letter): SeatMapElement => {
            const designator = `${row}${letter}`;
            const taken = hash(`${key}|${segmentRef}|${designator}`) % 5 === 0;
            const eligible = exit ? seated.filter((p) => p.type === 'adult') : seated;
            const services = taken
              ? []
              : eligible.map((p) => ({ passengerRef: p.ref, serviceId: `seat:${key}:${segmentRef}:${designator}:${p.ref}`, price }));
            return {
              type: 'seat',
              designator,
              available: services.length > 0,
              name,
              ...(exit ? { disclosures: ['Passengers in exit rows must be adults able to assist in an evacuation.'] } : {}),
              services,
            };
          }),
        })),
      });
    }
    return { segmentRef, cabins: [{ deck: 0, rows }] };
  }

  private serviceCatalogue(offer: FlightOffer): Map<string, { price: Money; max: number }> {
    const catalogue = new Map<string, { price: Money; max: number }>();
    for (const bag of this.bags(offer)) catalogue.set(bag.serviceId, { price: bag.price, max: bag.maxQuantity });
    for (const seg of offer.slices.flatMap((s) => s.segments)) {
      for (const row of this.seatMap(offer, seg.ref).cabins[0].rows) {
        for (const el of row.sections.flatMap((s) => s.elements)) {
          if (el.type !== 'seat') continue;
          for (const svc of el.services) catalogue.set(svc.serviceId, { price: svc.price, max: 1 });
        }
      }
    }
    return catalogue;
  }

  // All offers for a request, in a fixed order (the PRNG is sequential, so offer i depends on 0..i-1).
  private generate(req: SearchRequest, nonce: string | undefined): GeneratedOffer[] {
    const route = `${req.origin}-${req.destination}`;
    const seed = hash(
      [req.origin, req.destination, req.departureDate, req.returnDate ?? '', req.cabin,
        req.adults, req.children, req.infants, req.currency ?? ''].join('|'),
    );
    const rand = prng(seed);
    const expiresAt = new Date(this.now() + OFFER_TTL_MS).toISOString();
    // Same route → same "direct flight time", so durations are consistent across offers.
    const outboundMinutes = 60 + (hash(route) % 600);
    const returnMinutes = 60 + (hash(`${req.destination}-${req.origin}`) % 600);

    const result: GeneratedOffer[] = [];
    for (let i = 0; i < OFFERS_PER_SEARCH; i++) {
      const fare = FARES[i % FARES.length];
      const stops = i % 2; // alternate direct / 1-stop
      const slices = [
        this.buildSlice(rand, fare.carrier, req.origin, req.destination, req.departureDate,
          outboundMinutes, stops, req.cabin, 0),
      ];
      if (req.returnDate) {
        slices.push(this.buildSlice(rand, fare.carrier, req.destination, req.origin,
          req.returnDate, returnMinutes, stops, req.cabin, 1));
      }

      // Longer trips cost more; connections are 15% cheaper than direct.
      const totalMinutes = BigInt(outboundMinutes + (req.returnDate ? returnMinutes : 0));
      let unitBaseCents = (5_000n + totalMinutes * 15n + BigInt(rand(20_000))) * CABIN_MULTIPLIER[req.cabin];
      if (stops > 0) unitBaseCents = (unitBaseCents * 85n) / 100n;
      const unitTaxCents = (unitBaseCents * TAX_PCT) / 100n;

      const supplierOfferId = encodeOfferId(req, i, nonce);
      const offer: FlightOffer = {
        id: `${this.name}:${supplierOfferId}`,
        supplier: this.name,
        supplierOfferId,
        expiresAt,
        price: buildPrice(req, unitBaseCents, unitTaxCents),
        owner: fare.carrier,
        slices,
        passengers: passengerSlots(req),
        baggage: fare.baggage,
        fareBrand: fare.fareBrand,
        refundable: fare.refundable,
        changeable: fare.changeable,
        requiresInstantPayment: fare.requiresInstantPayment,
        supplierRef: { fareKey: `${seed.toString(36)}-${i}` },
      };
      result.push({ offer, unitBaseCents, unitTaxCents });
    }
    return result;
  }

  private buildSlice(
    rand: (max: number) => number,
    carrier: Carrier,
    origin: string,
    destination: string,
    date: string,
    directMinutes: number,
    stops: number,
    cabin: CabinClass,
    sliceIdx: number,
  ): Slice {
    // Departures between 06:00 and 21:55, on 5-minute marks.
    const depMinuteOfDay = 6 * 60 + rand(16 * 12) * 5;
    const departureAt = addMinutesLocal(`${date}T00:00:00`, depMinuteOfDay);
    let segIdx = 0;
    // Mock simplification: all airports share one clock, so arrival = departure + flight time.
    const segment = (from: string, to: string, at: string, minutes: number): Segment => ({
      ref: `s${sliceIdx}-${segIdx++}`,
      marketingCarrier: carrier,
      operatingCarrier: carrier,
      flightNumber: String(100 + rand(900)),
      origin: from,
      destination: to,
      departureTerminal: String(1 + rand(5)),
      arrivalTerminal: String(1 + rand(5)),
      departureAt: at,
      arrivalAt: addMinutesLocal(at, minutes),
      durationMinutes: minutes,
      // One rand() call either way, so the rest of the sequence (and every price) is unchanged.
      aircraft: (isWideBody(minutes) ? WIDE_AIRCRAFT : NARROW_AIRCRAFT)[rand(2)],
      cabin,
    });

    let segments: Segment[];
    if (stops === 0) {
      segments = [segment(origin, destination, departureAt, directMinutes)];
    } else {
      const hub = HUBS.filter((h) => h !== origin && h !== destination)[rand(HUBS.length - 2)];
      // A detour via a hub: each leg ~55% of the direct time, plus a 1–3h connection.
      const leg = Math.round(directMinutes * 0.55);
      const layover = 60 + rand(25) * 5;
      const first = segment(origin, hub, departureAt, leg);
      const second = segment(hub, destination, addMinutesLocal(first.arrivalAt, layover), leg);
      segments = [first, second];
    }

    const last = segments[segments.length - 1];
    return {
      origin,
      destination,
      departureAt,
      arrivalAt: last.arrivalAt,
      durationMinutes: minutesBetween(departureAt, last.arrivalAt),
      stops,
      segments,
    };
  }

  private throwIfAborted(opts: CallOptions): void {
    if (opts.signal?.aborted) {
      throw new SupplierError('TIMEOUT', this.name, 'Mock supplier call aborted');
    }
  }
}

// Compact offer key carried inside supplierOfferId. Fixed key order → deterministic ids.
interface OfferKey {
  o: string;
  d: string;
  dep: string;
  ret?: string;
  a: number;
  c: number;
  i: number;
  cab: CabinClass;
  cur?: string;
  idx: number;
  /** Per-search nonce: the "offer request" this offer belongs to. */
  n?: string;
}

function encodeOfferId(req: SearchRequest, idx: number, nonce: string | undefined): string {
  const key: OfferKey = {
    o: req.origin,
    d: req.destination,
    dep: req.departureDate,
    ret: req.returnDate, // undefined keys are dropped by JSON.stringify
    a: req.adults,
    c: req.children,
    i: req.infants,
    cab: req.cabin,
    cur: req.currency,
    idx,
    n: nonce,
  };
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

// IATA airport or ISO 4217 currency code.
const CODE3 = /^[A-Z]{3}$/;

function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(v); // rejects 2026-02-30
}

function isCount(v: unknown, min: number, max: number): v is number {
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
}

// The id arrives from outside (via the API), so validate every field: a forged or corrupt id must
// become OFFER_NOT_FOUND, never an exception or a nonsense offer.
function decodeOfferId(id: string): { req: SearchRequest; idx: number; nonce?: string } | null {
  let k: Partial<Record<keyof OfferKey, unknown>>;
  try {
    k = JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof k !== 'object' || k === null) return null;
  const { o, d, dep, ret, a, c, i, cab, cur, idx, n } = k;
  if (typeof o !== 'string' || !CODE3.test(o) || typeof d !== 'string' || !CODE3.test(d) || o === d) {
    return null;
  }
  if (!isDate(dep) || (ret !== undefined && (!isDate(ret) || ret < dep))) return null;
  if (!isCount(a, 1, 9) || !isCount(c, 0, 8) || !isCount(i, 0, a)) return null;
  if (typeof cab !== 'string' || !Object.hasOwn(CABIN_MULTIPLIER, cab)) return null;
  if (cur !== undefined && (typeof cur !== 'string' || !CODE3.test(cur))) return null;
  if (!isCount(idx, 0, OFFERS_PER_SEARCH - 1)) return null;
  if (n !== undefined && (typeof n !== 'string' || !/^[A-Za-z0-9_-]{8}$/.test(n))) return null;
  return {
    req: {
      origin: o,
      destination: d,
      departureDate: dep,
      returnDate: ret,
      adults: a,
      children: c,
      infants: i,
      cabin: cab as CabinClass,
      currency: cur,
    },
    idx,
    nonce: n,
  };
}

function isWideBody(segmentMinutes: number): boolean {
  return segmentMinutes > WIDE_BODY_MINUTES;
}

// p1…pN in search order: adults, children, infants (the order every supplier returns them in).
function passengerSlots(req: SearchRequest): OfferPassenger[] {
  const types = [
    ...Array<OfferPassenger['type']>(req.adults).fill('adult'),
    ...Array<OfferPassenger['type']>(req.children).fill('child'),
    ...Array<OfferPassenger['type']>(req.infants).fill('infant'),
  ];
  return types.map((type, i) => ({ ref: `p${i + 1}`, type }));
}

// Short stable key of an offer, embedded in its service ids so they can't be used on another offer.
function offerKey(supplierOfferId: string): string {
  return hash(supplierOfferId).toString(36);
}

// Mock prices are authored in cents; rescale to the currency's real minor unit (JPY 0, KWD 3).
function scaleCents(cents: bigint, currency: string): bigint {
  return (cents * 10n ** BigInt(currencyDigits(currency))) / 100n;
}

// Stateless order id: everything retrieveOrder() returns is encoded in it.
function orderResult(idempotencyKey: string, total: Money): OrderResult {
  let pnr = '';
  for (let i = 0; i < 6; i++) pnr += PNR_ALPHABET[hash(`${idempotencyKey}:${i}`) % PNR_ALPHABET.length];
  const payload = { k: idempotencyKey, a: total.amount, c: total.currency };
  return {
    supplierOrderId: `mko_${Buffer.from(JSON.stringify(payload)).toString('base64url')}`,
    pnr,
    status: 'confirmed',
    total,
  };
}

function decodeOrderId(id: string): OrderResult | null {
  if (!id.startsWith('mko_')) return null;
  try {
    const { k, a, c } = JSON.parse(Buffer.from(id.slice(4), 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof k !== 'string' || typeof a !== 'string' || typeof c !== 'string') return null;
    return orderResult(k, { amount: a, currency: c });
  } catch {
    return null;
  }
}

// Only valid for two local times at the same (mock) airport clock.
function minutesBetween(a: string, b: string): number {
  return (Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / 60_000;
}

function buildPrice(req: SearchRequest, unitBaseCents: bigint, unitTaxCents: bigint): FlightOffer['price'] {
  const currency = req.currency ?? 'USD';
  const unitBase = scaleCents(unitBaseCents, currency);
  const unitTax = scaleCents(unitTaxCents, currency);

  const rows: Array<{ type: PassengerPrice['type']; count: number; pct: bigint }> = [
    { type: 'adult', count: req.adults, pct: 100n },
    { type: 'child', count: req.children, pct: CHILD_PCT },
    { type: 'infant', count: req.infants, pct: INFANT_PCT },
  ];

  let base = 0n;
  let taxes = 0n;
  const perPassenger: PassengerPrice[] = [];
  for (const { type, count, pct } of rows) {
    if (count === 0) continue;
    const rowBase = ((unitBase * pct) / 100n) * BigInt(count);
    const rowTax = ((unitTax * pct) / 100n) * BigInt(count);
    base += rowBase;
    taxes += rowTax;
    perPassenger.push({ type, count, total: moneyFromMinor(rowBase + rowTax, currency) });
  }

  return {
    total: moneyFromMinor(base + taxes, currency),
    base: moneyFromMinor(base, currency),
    taxes: moneyFromMinor(taxes, currency),
    perPassenger,
  };
}
