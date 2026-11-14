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

interface StoredOffer {
  offer: FlightOffer;
  req: SearchRequest;
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
  // Filled by search(), read by price(). In-memory only: offers vanish on restart (fine for a mock).
  private readonly offers = new Map<string, StoredOffer>();

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

    this.pruneExpired();
    const seed = hash(
      [req.origin, req.destination, req.departureDate, req.returnDate ?? '', req.cabin,
        req.adults, req.children, req.infants, req.currency ?? ''].join('|'),
    );
    const rand = prng(seed);
    const expiresAt = new Date(this.now() + OFFER_TTL_MS).toISOString();
    // Same route → same "direct flight time", so durations are consistent across offers.
    const outboundMinutes = 60 + (hash(route) % 600);
    const returnMinutes = 60 + (hash(`${req.destination}-${req.origin}`) % 600);

    const result: FlightOffer[] = [];
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

      const supplierOfferId = `mk_${seed.toString(36)}_${i}`;
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
      this.offers.set(supplierOfferId, { offer, req, unitBaseCents, unitTaxCents });
      result.push(offer);
    }
    return result;
  }

  async price(supplierOfferId: string, opts: PriceOptions = {}): Promise<PricedOffer> {
    this.throwIfAborted(opts);
    const stored = this.offers.get(supplierOfferId);
    if (!stored) {
      throw new SupplierError('OFFER_NOT_FOUND', this.name, `Offer ${supplierOfferId} not found`);
    }
    if (Date.parse(stored.offer.expiresAt) <= this.now()) {
      this.offers.delete(supplierOfferId);
      throw new SupplierError('OFFER_EXPIRED', this.name, `Offer ${supplierOfferId} has expired`);
    }

    const { offer, req } = stored;
    let { unitTaxCents } = stored;
    const route = `${offer.slices[0].origin}-${offer.slices[0].destination}`;
    if (route === PRICE_CHANGE_ROUTE) {
      // Scenario: the airline raised the fare since search (surcharge lands in taxes).
      unitTaxCents += (stored.unitBaseCents * PRICE_CHANGE_PCT) / 100n;
    }
    const latest: FlightOffer = { ...offer, price: buildPrice(req, stored.unitBaseCents, unitTaxCents) };
    try {
      return { ...latest, ...priceChange(opts.previousTotal ?? offer.price.total, latest.price.total) };
    } catch (err) {
      // Currency differs from previousTotal: not comparable. Same code as DuffelAdapter.
      throw new SupplierError('UPSTREAM_ERROR', this.name, (err as Error).message, { cause: err });
    }
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

  private pruneExpired(): void {
    const now = this.now();
    for (const [id, { offer }] of this.offers) {
      if (Date.parse(offer.expiresAt) <= now) this.offers.delete(id);
    }
  }

  private throwIfAborted(opts: CallOptions): void {
    if (opts.signal?.aborted) {
      throw new SupplierError('TIMEOUT', this.name, 'Mock supplier call aborted');
    }
  }
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
