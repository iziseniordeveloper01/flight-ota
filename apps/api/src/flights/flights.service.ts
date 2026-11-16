import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  compareMoney,
  offerFingerprint,
  priceChange,
  type FlightOffer,
  type PricedOffer,
  type SupplierAdapter,
  type SupplierName,
} from '@ota/suppliers';
import { JsonCacheService } from '../redis/json-cache.service.js';
import type { SearchFlightsBody } from '@ota/contracts';
import { callSupplier, fareNoLongerAvailable } from './supplier-errors.js';
import { SUPPLIER_ADAPTER } from './supplier.provider.js';

// Prices are volatile: a short search TTL, and never longer than the offers stay valid.
// Bump the version when a cached shape changes, to orphan stale entries.
const SEARCH_TTL_SECONDS = 10 * 60;
const OFFER_MIN_TTL_SECONDS = 60;
const SUPPLIER_TIMEOUT_MS = 30_000;

export interface SearchResult {
  offers: FlightOffer[];
  cached: boolean;
  /** Currency shared by all offers; null when there are none or they are mixed. */
  currency: string | null;
}

/**
 * One offer as the customer last saw it, plus the search that produced it (server-only: needed to
 * re-shop at checkout). Kept beside the offer, not inside it, so it can't leak via toPublicOffer().
 */
interface CachedOffer {
  offer: FlightOffer;
  search: SearchFlightsBody;
}

const offerKey = (id: string) => `flights:offer:v2:${id}`;

@Injectable()
export class FlightsService {
  private readonly logger = new Logger(FlightsService.name);

  constructor(
    @Inject(SUPPLIER_ADAPTER) private readonly adapter: SupplierAdapter,
    private readonly cache: JsonCacheService,
  ) {}

  get supplier(): SupplierName {
    return this.adapter.name;
  }

  /** Cache-aside search. `fresh` skips the cache read (re-shop) but still stores the new results. */
  async search(req: SearchFlightsBody, opts: { fresh?: boolean } = {}): Promise<SearchResult> {
    const key = this.searchKey(req);

    // A cache failure is just a miss, it never breaks search.
    const cached = opts.fresh ? null : await this.cache.get<FlightOffer[]>(key);
    if (cached) return { offers: cached, cached: true, currency: sharedCurrency(cached) };

    const offers = await this.callSupplier('search', () =>
      this.adapter.search(req, { timeoutMs: SUPPLIER_TIMEOUT_MS }),
    );
    const currency = sharedCurrency(offers);
    const sorted = currency ? sortByTotal(offers) : offers;
    if (!currency && offers.length > 0) {
      // Comparing amounts across currencies would be wrong, so keep the supplier's order.
      this.logger.warn(`supplier=${this.supplier} returned mixed currencies; results left unsorted`);
    }

    // Never serve a cached result containing an offer that has already expired.
    const searchTtl = this.searchTtl(sorted);
    await this.cache.setMany([
      ...(searchTtl > 0 ? [{ key, value: sorted, ttlSeconds: searchTtl }] : []),
      // Each offer individually (with its search), so it can be re-priced or re-shopped later.
      ...sorted.map((offer) => ({
        key: offerKey(offer.id),
        value: { offer, search: req } satisfies CachedOffer,
        ttlSeconds: offerTtl(offer),
      })),
    ]);
    return { offers: sorted, cached: false, currency };
  }

  /** Latest price of a cached offer (GET /flights/offers/:id). 410 when gone. */
  async getOffer(id: string): Promise<PricedOffer> {
    const { offer: cached, search } = await this.cachedOffer(id);
    const priced = await this.callSupplier('price', () =>
      this.adapter.price(cached.supplierOfferId, {
        timeoutMs: SUPPLIER_TIMEOUT_MS,
        previousTotal: cached.price.total,
      }),
    );

    // Store the latest price (without the comparison fields) so the next check compares to it.
    const { priceChanged: _changed, previousTotal: _previous, ...latest } = priced;
    await this.cache.set(offerKey(id), { offer: latest, search } satisfies CachedOffer, offerTtl(latest));
    return priced;
  }

  /**
   * The same fare from a FRESH search, for booking. Suppliers allow one order per search (Duffel:
   * offer request; TBO: TraceId), so a booking must never use the offer shared by everyone who saw
   * the cached results. Matched by offerFingerprint(); `priceChanged` compares with the cached
   * total (what the customer last saw). No match → 410 FARE_NO_LONGER_AVAILABLE.
   */
  async reshop(id: string): Promise<PricedOffer> {
    const { offer: seen, search } = await this.cachedOffer(id);
    const { offers } = await this.search(search, { fresh: true });
    const fresh = sameFare(offers, seen);
    if (!fresh) {
      this.logger.warn(`reshop: fare not in the fresh search supplier=${this.supplier} offers=${offers.length}`);
      throw fareNoLongerAvailable();
    }
    if (fresh.price.total.currency !== seen.price.total.currency) {
      // Not comparable: show it as a price change (the customer sees the new total before paying).
      return { ...fresh, priceChanged: true, previousTotal: seen.price.total };
    }
    return { ...fresh, ...priceChange(seen.price.total, fresh.price.total) };
  }

  private async cachedOffer(id: string): Promise<CachedOffer> {
    // The offer cache is the only record of what the customer saw; without Redis we can't go on.
    // A failed read is an outage (503, retry), never "gone": only a missing key means expired.
    const unavailable = () => new ServiceUnavailableException('Offer lookup is temporarily unavailable');
    if (!this.cache.isReady) throw unavailable();
    let cached: CachedOffer | null;
    try {
      cached = await this.cache.getRequired<CachedOffer>(offerKey(id));
    } catch (err) {
      this.logger.warn(`Offer lookup failed: ${(err as Error).message}`);
      throw unavailable();
    }
    // A missing offer is almost always an expired one; an offer from another supplier (SUPPLIER
    // switched since the search) can't be priced by the current adapter either.
    if (!cached || cached.offer.supplier !== this.supplier) throw fareNoLongerAvailable();
    return cached;
  }

  // Hash of the normalized request; the supplier is part of it so switching SUPPLIER never serves
  // another supplier's offers. Fixed key order keeps the hash stable.
  private searchKey(req: SearchFlightsBody): string {
    const normalized = {
      supplier: this.supplier,
      origin: req.origin,
      destination: req.destination,
      departureDate: req.departureDate,
      returnDate: req.returnDate ?? null,
      adults: req.adults,
      children: req.children,
      infants: req.infants,
      cabin: req.cabin,
      currency: req.currency ?? null,
    };
    const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    return `flights:search:v1:${hash}`;
  }

  private searchTtl(offers: FlightOffer[]): number {
    if (offers.length === 0) return SEARCH_TTL_SECONDS;
    const earliest = Math.min(...offers.map((o) => secondsUntil(o.expiresAt)));
    return Math.min(SEARCH_TTL_SECONDS, earliest);
  }

  private callSupplier<T>(operation: string, call: () => Promise<T>): Promise<T> {
    return callSupplier(this.logger, operation, call);
  }
}

/**
 * The fresh offer for the fare the customer chose. Several offers can share a fingerprint (e.g. the
 * same brand with different conditions): prefer the one at the price they saw, else the cheapest.
 */
function sameFare(offers: FlightOffer[], seen: FlightOffer): FlightOffer | undefined {
  const key = offerFingerprint(seen);
  const matches = offers.filter((o) => offerFingerprint(o) === key);
  const samePrice = matches.find(
    (o) => o.price.total.currency === seen.price.total.currency && compareMoney(o.price.total, seen.price.total) === 0,
  );
  return samePrice ?? (sharedCurrency(matches) ? sortByTotal(matches)[0] : matches[0]);
}

function offerTtl(offer: FlightOffer): number {
  return Math.max(OFFER_MIN_TTL_SECONDS, secondsUntil(offer.expiresAt));
}

function secondsUntil(iso: string): number {
  return Math.floor((Date.parse(iso) - Date.now()) / 1000);
}

function sharedCurrency(offers: FlightOffer[]): string | null {
  const currencies = new Set(offers.map((o) => o.price.total.currency));
  return currencies.size === 1 ? [...currencies][0] : null;
}

// Only called when all offers share a currency (compareMoney throws otherwise). Stable sort keeps
// the supplier's order for equal prices.
function sortByTotal(offers: FlightOffer[]): FlightOffer[] {
  return [...offers].sort((a, b) => compareMoney(a.price.total, b.price.total));
}
