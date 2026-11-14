import type { SupplierAdapter } from '../adapter.js';
import { callSignal } from '../call.js';
import { SupplierError } from '../errors.js';
import { priceChange } from '../money.js';
import type { CallOptions, FlightOffer, PriceOptions, PricedOffer, SearchRequest } from '../types.js';
import { fromDuffelResponse, fromDuffelThrown } from './duffel.errors.js';
import { toFlightOffer, toOfferRequest, type DuffelOffer } from './duffel.mapper.js';
import type { ApiResponseError, OfferRequest } from './duffel.types.js';

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
    // Offer ids are Duffel-generated ("off_..."); reject anything else before building a URL.
    if (!/^off_[A-Za-z0-9]+$/.test(supplierOfferId)) {
      throw new SupplierError('OFFER_NOT_FOUND', this.name, 'Unknown Duffel offer id');
    }
    // GET single offer returns the latest price from the airline.
    const offer = await this.request<DuffelOffer>('GET', `/air/offers/${supplierOfferId}`, undefined, opts);
    if (Date.parse(offer.expires_at) <= Date.now()) {
      throw new SupplierError('OFFER_EXPIRED', this.name, `Offer ${supplierOfferId} has expired`);
    }
    // A single offer has no request context; the segment's own cabin_class wins anyway.
    const latest = this.mapOrThrow(() => toFlightOffer(offer, 'economy'));
    try {
      return { ...latest, ...priceChange(opts.previousTotal, latest.price.total) };
    } catch (err) {
      // Currency changed between search and re-price: not comparable, surface it.
      throw new SupplierError('UPSTREAM_ERROR', this.name, (err as Error).message, { cause: err });
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
