import { createHash } from 'node:crypto';
import { GoneException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  compareMoney,
  type FlightOffer,
  type PricedOffer,
  type SupplierAdapter,
  type SupplierName,
} from '@ota/suppliers';
import { JsonCacheService } from '../redis/json-cache.service.js';
import type { SearchFlightsBody } from '@ota/contracts';
import { callSupplier, GONE_MESSAGE } from './supplier-errors.js';
import { SUPPLIER_ADAPTER } from './supplier.provider.js';

// Prices are volatile: a short search TTL, and never longer than the offers stay valid.
// Bump "v1" when the cached shape changes, to orphan stale entries.
const SEARCH_TTL_SECONDS = 10 * 60;
const OFFER_MIN_TTL_SECONDS = 60;
const SUPPLIER_TIMEOUT_MS = 30_000;

export interface SearchResult {
  offers: FlightOffer[];
  cached: boolean;
  /** Currency shared by all offers; null when there are none or they are mixed. */
  currency: string | null;
}

const offerKey = (id: string) => `flights:offer:v1:${id}`;

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

  async search(req: SearchFlightsBody): Promise<SearchResult> {
    const key = this.searchKey(req);

    // Cache-aside; a cache failure is just a miss, it never breaks search.
    const cached = await this.cache.get<FlightOffer[]>(key);
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
      // Each offer individually, so GET /flights/offers/:id can re-price it later.
      ...sorted.map((offer) => ({
        key: offerKey(offer.id),
        value: offer,
        ttlSeconds: Math.max(OFFER_MIN_TTL_SECONDS, secondsUntil(offer.expiresAt)),
      })),
    ]);
    return { offers: sorted, cached: false, currency };
  }

  async getOffer(id: string): Promise<PricedOffer> {
    // The offer cache is the only record of what the customer saw; without Redis we can't re-price.
    if (!this.cache.isReady) {
      throw new ServiceUnavailableException('Offer lookup is temporarily unavailable');
    }
    const cached = await this.cache.get<FlightOffer>(offerKey(id));
    // A missing offer is almost always an expired one; an offer from another supplier (SUPPLIER
    // switched since the search) can't be priced by the current adapter either.
    if (!cached || cached.supplier !== this.supplier) throw new GoneException(GONE_MESSAGE);

    const priced = await this.callSupplier('price', () =>
      this.adapter.price(cached.supplierOfferId, {
        timeoutMs: SUPPLIER_TIMEOUT_MS,
        previousTotal: cached.price.total,
      }),
    );

    // Store the latest price (without the comparison fields) so the next check compares to it.
    const { priceChanged: _changed, previousTotal: _previous, ...latest } = priced;
    await this.cache.set(
      offerKey(id),
      latest,
      Math.max(OFFER_MIN_TTL_SECONDS, secondsUntil(latest.expiresAt)),
    );
    return priced;
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
