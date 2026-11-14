import type { SupplierAdapter } from '../adapter.js';
import { SupplierError } from '../errors.js';
import { addMinutesLocal } from '../local-time.js';
import { currencyDigits, moneyFromMinor, priceChange } from '../money.js';
import type {
  BaggageAllowance,
  CabinClass,
  CallOptions,
  Carrier,
  FlightOffer,
  PassengerPrice,
  PriceOptions,
  PricedOffer,
  SearchRequest,
  Segment,
  Slice,
} from '../types.js';

// Offline, deterministic supplier for development and tests. Same request → same offers
// (only expiresAt moves with the clock). No network, no Math.random.
// Stateless: each supplierOfferId encodes the search request + offer index, so price() regenerates
// the offer on any instance — searches cached in Redis stay selectable across API restarts.

const OFFER_TTL_MS = 20 * 60_000;
const OFFERS_PER_SEARCH = 10;

// Scenario routes mirror Duffel's test-mode behaviours so error handling is testable offline.
const NO_OFFERS_ROUTE = 'PVD-RAI';
const TIMEOUT_ROUTE = 'STN-LHR';
const PRICE_CHANGE_ROUTE = 'LHR-STN';
const PRICE_CHANGE_PCT = 12n;

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
const AIRCRAFT = ['Airbus A320neo', 'Boeing 737-800', 'Airbus A350-900', 'Boeing 787-9'];
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
    return this.generate(req).map(({ offer }) => offer);
  }

  async price(supplierOfferId: string, opts: PriceOptions = {}): Promise<PricedOffer> {
    this.throwIfAborted(opts);
    const decoded = decodeOfferId(supplierOfferId);
    if (!decoded) {
      throw new SupplierError('OFFER_NOT_FOUND', this.name, 'Offer not found');
    }
    const { req, idx } = decoded;
    // UTC date, same rule as the search date bounds in @ota/contracts.
    if (req.departureDate < new Date(this.now()).toISOString().slice(0, 10)) {
      throw new SupplierError('OFFER_EXPIRED', this.name, 'Offer has expired (departure date passed)');
    }

    const generated = this.generate(req)[idx];
    const { offer, unitBaseCents } = generated;
    let { unitTaxCents } = generated;
    if (`${req.origin}-${req.destination}` === PRICE_CHANGE_ROUTE) {
      // Scenario: the airline raised the fare since search (surcharge lands in taxes).
      unitTaxCents += (unitBaseCents * PRICE_CHANGE_PCT) / 100n;
    }
    const latest: FlightOffer = { ...offer, price: buildPrice(req, unitBaseCents, unitTaxCents) };
    try {
      return { ...latest, ...priceChange(opts.previousTotal ?? offer.price.total, latest.price.total) };
    } catch (err) {
      // Currency differs from previousTotal: not comparable. Same code as DuffelAdapter.
      throw new SupplierError('UPSTREAM_ERROR', this.name, (err as Error).message, { cause: err });
    }
  }

  // All offers for a request, in a fixed order (the PRNG is sequential, so offer i depends on 0..i-1).
  private generate(req: SearchRequest): GeneratedOffer[] {
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
          outboundMinutes, stops, req.cabin),
      ];
      if (req.returnDate) {
        slices.push(this.buildSlice(rand, fare.carrier, req.destination, req.origin,
          req.returnDate, returnMinutes, stops, req.cabin));
      }

      // Longer trips cost more; connections are 15% cheaper than direct.
      const totalMinutes = BigInt(outboundMinutes + (req.returnDate ? returnMinutes : 0));
      let unitBaseCents = (5_000n + totalMinutes * 15n + BigInt(rand(20_000))) * CABIN_MULTIPLIER[req.cabin];
      if (stops > 0) unitBaseCents = (unitBaseCents * 85n) / 100n;
      const unitTaxCents = (unitBaseCents * TAX_PCT) / 100n;

      const supplierOfferId = encodeOfferId(req, i);
      const offer: FlightOffer = {
        id: `${this.name}:${supplierOfferId}`,
        supplier: this.name,
        supplierOfferId,
        expiresAt,
        price: buildPrice(req, unitBaseCents, unitTaxCents),
        owner: fare.carrier,
        slices,
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
  ): Slice {
    // Departures between 06:00 and 21:55, on 5-minute marks.
    const depMinuteOfDay = 6 * 60 + rand(16 * 12) * 5;
    const departureAt = addMinutesLocal(`${date}T00:00:00`, depMinuteOfDay);
    // Mock simplification: all airports share one clock, so arrival = departure + flight time.
    const segment = (from: string, to: string, at: string, minutes: number): Segment => ({
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
      aircraft: AIRCRAFT[rand(AIRCRAFT.length)],
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
}

function encodeOfferId(req: SearchRequest, idx: number): string {
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
function decodeOfferId(id: string): { req: SearchRequest; idx: number } | null {
  let k: Partial<Record<keyof OfferKey, unknown>>;
  try {
    k = JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof k !== 'object' || k === null) return null;
  const { o, d, dep, ret, a, c, i, cab, cur, idx } = k;
  if (typeof o !== 'string' || !CODE3.test(o) || typeof d !== 'string' || !CODE3.test(d) || o === d) {
    return null;
  }
  if (!isDate(dep) || (ret !== undefined && (!isDate(ret) || ret < dep))) return null;
  if (!isCount(a, 1, 9) || !isCount(c, 0, 8) || !isCount(i, 0, a)) return null;
  if (typeof cab !== 'string' || !Object.hasOwn(CABIN_MULTIPLIER, cab)) return null;
  if (cur !== undefined && (typeof cur !== 'string' || !CODE3.test(cur))) return null;
  if (!isCount(idx, 0, OFFERS_PER_SEARCH - 1)) return null;
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
  };
}

// Only valid for two local times at the same (mock) airport clock.
function minutesBetween(a: string, b: string): number {
  return (Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / 60_000;
}

function buildPrice(req: SearchRequest, unitBaseCents: bigint, unitTaxCents: bigint): FlightOffer['price'] {
  const currency = req.currency ?? 'USD';
  // Prices are generated in cents; rescale to the currency's real minor unit (JPY 0, KWD 3).
  const scale = (cents: bigint) => (cents * 10n ** BigInt(currencyDigits(currency))) / 100n;
  const unitBase = scale(unitBaseCents);
  const unitTax = scale(unitTaxCents);

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
