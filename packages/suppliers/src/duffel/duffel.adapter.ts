import type { SupplierAdapter } from '../adapter.js';
import { callSignal } from '../call.js';
import { SupplierError } from '../errors.js';
import { multiplyMoney, priceChange, sumMoney } from '../money.js';
import type {
  Ancillaries,
  CallOptions,
  CreateOrderInput,
  FlightOffer,
  Money,
  OrderLookup,
  OrderResult,
  PriceOptions,
  PricedOffer,
  SearchRequest,
  SeatMap,
} from '../types.js';
import {
  BOOKING_METADATA_KEY,
  duffelFamilyName,
  toAncillaries,
  toCreateOrder,
  toOrderResult,
  toSeatMap,
} from './duffel.booking-mapper.js';
import { fromDuffelResponse, fromDuffelThrown } from './duffel.errors.js';
import { toFlightOffer, toOfferRequest, type DuffelOffer } from './duffel.mapper.js';
import type { ApiResponseError, Offer, OfferRequest, Order, SeatMap as DuffelSeatMap } from './duffel.types.js';

const DEFAULT_BASE_URL = 'https://api.duffel.com';
// Same API version the official SDK (@duffel/api 4.x) sends.
const DUFFEL_VERSION = 'v2';

export interface DuffelAdapterOptions {
  accessToken: string;
  baseUrl?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/**
 * Duffel via its REST API with native fetch. We use the SDK's types but not its HTTP client:
 * the SDK (node-fetch v2) accepts no AbortSignal, so its requests could never be cancelled.
 */
export class DuffelAdapter implements SupplierAdapter {
  readonly name = 'duffel' as const;
  // Private fields (#) keep the token out of JSON.stringify, console.log and Nest's inspectors.
  readonly #accessToken: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: DuffelAdapterOptions) {
    if (!options.accessToken) throw new Error('DuffelAdapter: accessToken is required');
    this.#accessToken = options.accessToken;
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async search(req: SearchRequest, opts: CallOptions = {}): Promise<FlightOffer[]> {
    const offerRequest = await this.request<OfferRequest>(
      'POST',
      '/air/offer_requests?return_offers=true',
      toOfferRequest(req),
      opts,
    );
    return this.mapOrThrow(() => offerRequest.offers.map((o) => toFlightOffer(o, req.cabin)));
  }

  async price(supplierOfferId: string, opts: PriceOptions = {}): Promise<PricedOffer> {
    this.assertOfferId(supplierOfferId);
    // GET single offer returns the latest price from the airline.
    const offer = await this.request<DuffelOffer>('GET', `/air/offers/${supplierOfferId}`, undefined, opts);
    this.assertNotExpired(offer);
    // A single offer has no request context; the segment's own cabin_class wins anyway.
    const latest = this.mapOrThrow(() => toFlightOffer(offer, 'economy'));
    try {
      return { ...latest, ...priceChange(opts.previousTotal, latest.price.total) };
    } catch (err) {
      // Currency changed between search and re-price: not comparable, surface it.
      throw new SupplierError('UPSTREAM_ERROR', this.name, (err as Error).message, { cause: err });
    }
  }

  async getAncillaries(supplierOfferId: string, opts: CallOptions = {}): Promise<Ancillaries> {
    this.assertOfferId(supplierOfferId);
    // Bags live on the offer; whether seats exist is only known from the seat map endpoint.
    const [offer, seatMaps] = await Promise.all([
      this.offerWithServices(supplierOfferId, opts),
      this.rawSeatMaps(supplierOfferId, opts),
    ]);
    this.assertNotExpired(offer);
    return this.mapOrThrow(() => toAncillaries(offer, seatMaps));
  }

  async getSeatMaps(supplierOfferId: string, opts: CallOptions = {}): Promise<SeatMap[]> {
    this.assertOfferId(supplierOfferId);
    const maps = await this.rawSeatMaps(supplierOfferId, opts);
    return this.mapOrThrow(() => maps.map(toSeatMap));
  }

  async createOrder(input: CreateOrderInput, opts: CallOptions = {}): Promise<OrderResult> {
    this.assertOfferId(input.supplierOfferId);
    // No Idempotency-Key support at Duffel (Nov 2026): never retry this POST. Our booking id goes
    // into order.metadata so retrieveOrder() can find the order if the response is lost.
    try {
      const order = await this.request<Order>('POST', '/air/orders', toCreateOrder(input), opts);
      return this.mapOrThrow(() => toOrderResult(order));
    } catch (err) {
      if (err instanceof SupplierError && err.code === 'PRICE_CHANGED') {
        throw await this.withNewTotal(err, input, opts);
      }
      throw err;
    }
  }

  async retrieveOrder(lookup: OrderLookup, opts: CallOptions = {}): Promise<OrderResult | null> {
    try {
      if (lookup.supplierOrderId) {
        if (!/^ord_[A-Za-z0-9]+$/.test(lookup.supplierOrderId)) return null;
        const order = await this.request<Order>('GET', `/air/orders/${lookup.supplierOrderId}`, undefined, opts);
        return this.mapOrThrow(() => toOrderResult(order));
      }
      // Duffel can't filter by metadata: narrow by passenger name, then match our key. Orders can
      // take a while to appear in the API after a lost response, so null means "not yet".
      const name = encodeURIComponent(duffelFamilyName(lookup.leadPassenger));
      const orders = await this.request<Order[]>('GET', `/air/orders?passenger_name[]=${name}&limit=200`, undefined, opts);
      const order = orders.find((o) => o.metadata?.[BOOKING_METADATA_KEY] === lookup.idempotencyKey);
      return order ? this.mapOrThrow(() => toOrderResult(order)) : null;
    } catch (err) {
      if (err instanceof SupplierError && err.code === 'OFFER_NOT_FOUND') return null;
      throw err;
    }
  }

  private offerWithServices(supplierOfferId: string, opts: CallOptions): Promise<Offer> {
    return this.request<Offer>('GET', `/air/offers/${supplierOfferId}?return_available_services=true`, undefined, opts);
  }

  private rawSeatMaps(supplierOfferId: string, opts: CallOptions): Promise<DuffelSeatMap[]> {
    return this.request<DuffelSeatMap[]>('GET', `/air/seat_maps?offer_id=${supplierOfferId}`, undefined, opts);
  }

  // Duffel's price_changed error carries no amount. Best effort: re-read the offer and the chosen
  // services so the caller can show the new total; on any problem rethrow without it.
  private async withNewTotal(err: SupplierError, input: CreateOrderInput, opts: CallOptions): Promise<SupplierError> {
    try {
      const [offer, maps] = await Promise.all([
        this.offerWithServices(input.supplierOfferId, opts),
        input.services.length ? this.rawSeatMaps(input.supplierOfferId, opts) : Promise.resolve([]),
      ]);
      const ancillaries = toAncillaries(offer, maps);
      const prices = new Map<string, Money>(ancillaries.bags.map((b) => [b.serviceId, b.price]));
      for (const map of maps.map(toSeatMap)) {
        for (const row of map.cabins.flatMap((c) => c.rows)) {
          for (const el of row.sections.flatMap((s) => s.elements)) {
            if (el.type === 'seat') for (const s of el.services) prices.set(s.serviceId, s.price);
          }
        }
      }
      const lines = [{ amount: offer.total_amount, currency: offer.total_currency }];
      for (const s of input.services) {
        const unit = prices.get(s.serviceId);
        if (!unit) return err; // service gone: no meaningful "new total"
        lines.push(multiplyMoney(unit, s.quantity));
      }
      const newTotal = sumMoney(lines, offer.total_currency);
      return new SupplierError('PRICE_CHANGED', this.name, err.message, { cause: err, newTotal });
    } catch {
      return err;
    }
  }

  // Offer ids are Duffel-generated ("off_..."); reject anything else before building a URL.
  private assertOfferId(supplierOfferId: string): void {
    if (!/^off_[A-Za-z0-9]+$/.test(supplierOfferId)) {
      throw new SupplierError('OFFER_NOT_FOUND', this.name, 'Unknown Duffel offer id');
    }
  }

  private assertNotExpired(offer: { id: string; expires_at: string }): void {
    if (Date.parse(offer.expires_at) <= Date.now()) {
      throw new SupplierError('OFFER_EXPIRED', this.name, `Offer ${offer.id} has expired`);
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    opts: CallOptions,
  ): Promise<T> {
    try {
      const res = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Duffel-Version': DUFFEL_VERSION,
          Authorization: `Bearer ${this.#accessToken}`,
        },
        body: body === undefined ? undefined : JSON.stringify({ data: body }),
        // Aborts the socket on timeout or caller abort — including while the body downloads.
        signal: callSignal(opts),
      });
      const json = (await res.json().catch(() => undefined)) as
        | { data?: T; errors?: ApiResponseError[]; meta?: { request_id?: string } }
        | undefined;
      if (!res.ok) throw fromDuffelResponse(res.status, json?.errors, json?.meta?.request_id);
      if (json?.data === undefined) {
        throw new SupplierError('UPSTREAM_ERROR', this.name, `Duffel HTTP ${res.status}: empty body`);
      }
      return json.data;
    } catch (err) {
      throw fromDuffelThrown(err);
    }
  }

  // A response that doesn't match the documented shape is Duffel's problem, not a crash of ours.
  private mapOrThrow<T>(map: () => T): T {
    try {
      return map();
    } catch (err) {
      throw new SupplierError('UPSTREAM_ERROR', this.name, 'Unexpected Duffel response shape', {
        cause: err,
      });
    }
  }
}
