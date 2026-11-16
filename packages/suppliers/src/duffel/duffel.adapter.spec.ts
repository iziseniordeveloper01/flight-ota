import { describe, expect, it, vi } from 'vitest';
import { SupplierError } from '../errors.js';
import type { SearchRequest } from '../types.js';
import { oneWayOffer, returnOffer } from './__fixtures__/offers.js';
import { DuffelAdapter } from './duffel.adapter.js';

const ZZ_CARRIER = {
  code: 'ZZ',
  name: 'Duffel Airways',
  logoUrl: 'https://assets.duffel.com/img/airlines/for-light-background/full-color-logo/ZZ.svg',
};

const TOKEN = 'duffel_test_SECRET_DO_NOT_LEAK';
const req: SearchRequest = {
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2026-12-14',
  adults: 1,
  children: 0,
  infants: 0,
  cabin: 'economy',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Stands in for the network: no request ever leaves the test.
function adapterWith(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {}),
  );
  return { adapter: new DuffelAdapter({ accessToken: TOKEN, fetch: fetchMock as typeof fetch }), fetchMock };
}

async function errorOf(promise: Promise<unknown>): Promise<SupplierError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(SupplierError);
  return err as SupplierError;
}

describe('DuffelAdapter.search', () => {
  it('sends a well-formed offer request with auth, version and an AbortSignal', async () => {
    const { adapter, fetchMock } = adapterWith(() => json(201, { data: { offers: [] } }));
    await adapter.search({ ...req, returnDate: '2026-12-21', adults: 2, children: 1, infants: 1, cabin: 'business' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.duffel.com/air/offer_requests?return_offers=true');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({ 'Duffel-Version': 'v2', Authorization: `Bearer ${TOKEN}` });
    expect(JSON.parse(init.body as string)).toEqual({
      data: {
        cabin_class: 'business',
        slices: [
          { origin: 'LHR', destination: 'JFK', departure_date: '2026-12-14', departure_time: null, arrival_time: null },
          { origin: 'JFK', destination: 'LHR', departure_date: '2026-12-21', departure_time: null, arrival_time: null },
        ],
        passengers: [{ type: 'adult' }, { type: 'adult' }, { age: 10 }, { age: 1 }],
      },
    });
  });

  it('maps a one-way offer to FlightOffer', async () => {
    const { adapter } = adapterWith(() => json(201, { data: { offers: [oneWayOffer] } }));
    const [offer] = await adapter.search(req);

    expect(offer).toEqual({
      id: 'duffel:off_0000AUde3KY1SptM6ABSfT',
      supplier: 'duffel',
      supplierOfferId: 'off_0000AUde3KY1SptM6ABSfT',
      expiresAt: '2099-11-14T12:30:00.000000Z',
      price: {
        total: { amount: '512.34', currency: 'GBP' },
        base: { amount: '420.00', currency: 'GBP' },
        taxes: { amount: '92.34', currency: 'GBP' },
      },
      owner: ZZ_CARRIER,
      slices: [
        {
          origin: 'LHR',
          destination: 'JFK',
          departureAt: '2026-12-14T10:15:00',
          arrivalAt: '2026-12-14T13:05:00',
          durationMinutes: 470,
          stops: 0,
          segments: [
            {
              ref: 'seg_1',
              marketingCarrier: ZZ_CARRIER,
              operatingCarrier: ZZ_CARRIER,
              flightNumber: '0117',
              origin: 'LHR',
              destination: 'JFK',
              departureTerminal: '5',
              arrivalTerminal: '4',
              departureAt: '2026-12-14T10:15:00',
              arrivalAt: '2026-12-14T13:05:00',
              durationMinutes: 470,
              aircraft: 'Airbus Industrie A380-800',
              cabin: 'economy',
            },
          ],
        },
      ],
      passengers: [{ ref: 'pas_0000AUde3KY1SptM6ABSfU', type: 'adult' }],
      baggage: { checkedPieces: 1, cabinPieces: 1 },
      fareBrand: 'Basic',
      refundable: false,
      changeable: null,
      requiresInstantPayment: false,
      supplierRef: {
        offerId: 'off_0000AUde3KY1SptM6ABSfT',
        passengers: [{ id: 'pas_0000AUde3KY1SptM6ABSfU', type: 'adult', age: null }],
      },
    });
    expect(offer.price.perPassenger).toBeUndefined(); // Duffel gives no breakdown — never faked
  });

  it('leaves logoUrl undefined when Duffel has no logo for the airline', async () => {
    const noLogo = { ...oneWayOffer, owner: { ...oneWayOffer.owner, logo_symbol_url: null } };
    const { adapter } = adapterWith(() => json(201, { data: { offers: [noLogo] } }));
    const [offer] = await adapter.search(req);
    expect(offer.owner.logoUrl).toBeUndefined();
  });

  it('maps a return offer with a connection', async () => {
    const { adapter } = adapterWith(() => json(201, { data: { offers: [returnOffer] } }));
    const [offer] = await adapter.search({ ...req, returnDate: '2026-12-21' });

    expect(offer.slices).toHaveLength(2);
    const back = offer.slices[1];
    expect(back).toMatchObject({
      origin: 'JFK',
      destination: 'LHR',
      departureAt: '2026-12-21T18:00:00',
      arrivalAt: '2026-12-22T08:15:00',
      durationMinutes: 585,
      stops: 1,
    });
    expect(back.segments.map((s) => `${s.origin}-${s.destination}`)).toEqual(['JFK-DUB', 'DUB-LHR']);
    expect(back.segments[0].departureTerminal).toBeUndefined(); // null terminal → omitted
    expect(offer.price.taxes).toBeUndefined(); // tax_amount null → not invented
    expect(offer.refundable).toBeNull();
    expect(offer.changeable).toBe(true);
    expect(offer.requiresInstantPayment).toBe(true);
  });
});

describe('DuffelAdapter.price', () => {
  it('GETs the single offer and flags a price change vs previousTotal', async () => {
    const { adapter, fetchMock } = adapterWith(() => json(200, { data: oneWayOffer }));
    const priced = await adapter.price(oneWayOffer.id, {
      previousTotal: { amount: '499.99', currency: 'GBP' },
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.duffel.com/air/offers/${oneWayOffer.id}`);
    expect(priced.priceChanged).toBe(true);
    expect(priced.previousTotal).toEqual({ amount: '499.99', currency: 'GBP' });
    expect(priced.price.total.amount).toBe('512.34');

    const same = await adapter.price(oneWayOffer.id, { previousTotal: { amount: '512.340', currency: 'GBP' } });
    expect(same.priceChanged).toBe(false);
  });

  it('an offer past expires_at → OFFER_EXPIRED', async () => {
    const { adapter } = adapterWith(() =>
      json(200, { data: { ...oneWayOffer, expires_at: '2020-01-01T00:00:00Z' } }),
    );
    expect((await errorOf(adapter.price(oneWayOffer.id))).code).toBe('OFFER_EXPIRED');
  });

  it('a malformed id → OFFER_NOT_FOUND without any HTTP call', async () => {
    const { adapter, fetchMock } = adapterWith(() => json(200, {}));
    expect((await errorOf(adapter.price('../orders'))).code).toBe('OFFER_NOT_FOUND');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a currency switch vs previousTotal is an error, not "unchanged"', async () => {
    const { adapter } = adapterWith(() => json(200, { data: oneWayOffer }));
    const err = await errorOf(adapter.price(oneWayOffer.id, { previousTotal: { amount: '512.34', currency: 'USD' } }));
    expect(err.code).toBe('UPSTREAM_ERROR');
  });
});

describe('DuffelAdapter error mapping', () => {
  const duffelError = (status: number, type: string, code: string) =>
    json(status, {
      meta: { status, request_id: 'req_123' },
      errors: [{ type, code, title: 'Something', message: 'detail', documentation_url: 'https://duffel.com' }],
    });

  it.each([
    [422, 'validation_error', 'invalid_field', 'INVALID_REQUEST'],
    [400, 'invalid_request_error', 'bad_request', 'INVALID_REQUEST'],
    [422, 'invalid_state_error', 'offer_no_longer_available', 'OFFER_EXPIRED'],
    [422, 'invalid_state_error', 'order_creation_already_attempted', 'OFFER_EXPIRED'],
    [422, 'invalid_state_error', 'offer_request_already_booked', 'OFFER_EXPIRED'],
    [422, 'airline_error', 'price_changed', 'PRICE_CHANGED'],
    [422, 'validation_error', 'payment_amount_does_not_match_order_amount', 'PRICE_CHANGED'],
    [404, 'invalid_request_error', 'not_found', 'OFFER_NOT_FOUND'],
    [500, 'api_error', 'internal_server_error', 'UNAVAILABLE'],
    [503, 'api_error', 'service_unavailable', 'UNAVAILABLE'],
    [429, 'rate_limit_error', 'rate_limit_exceeded', 'UNAVAILABLE'],
    [401, 'authentication_error', 'unauthorized', 'UPSTREAM_ERROR'],
  ])('HTTP %i %s/%s → %s', async (status, type, code, expected) => {
    const { adapter } = adapterWith(() => duffelError(status, type, code));
    const err = await errorOf(adapter.search(req));
    expect(err.code).toBe(expected);
    expect(err.supplier).toBe('duffel');
    expect(err.message).toContain('req_123');
    expect(err.message).not.toContain(TOKEN);
  });

  it('a non-JSON 502 from a gateway → UNAVAILABLE', async () => {
    const { adapter } = adapterWith(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    expect((await errorOf(adapter.search(req))).code).toBe('UNAVAILABLE');
  });

  it('a network failure → UNAVAILABLE, token never in the message', async () => {
    const { adapter } = adapterWith(() => {
      throw new TypeError('fetch failed');
    });
    const err = await errorOf(adapter.search(req));
    expect(err.code).toBe('UNAVAILABLE');
    expect(err.message).not.toContain(TOKEN);
  });

  it('timeoutMs aborts the in-flight request → TIMEOUT', async () => {
    let seen: AbortSignal | undefined;
    // Behaves like fetch: hangs until the signal aborts, then rejects with the signal's reason.
    const { adapter } = adapterWith(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          seen = init.signal!;
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const err = await errorOf(adapter.search(req, { timeoutMs: 20 }));
    expect(err.code).toBe('TIMEOUT');
    expect(seen?.aborted).toBe(true);
  });

  it('a caller abort also cancels the request → TIMEOUT', async () => {
    const controller = new AbortController();
    const { adapter } = adapterWith(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
          controller.abort();
        }),
    );
    expect((await errorOf(adapter.search(req, { signal: controller.signal }))).code).toBe('TIMEOUT');
  });

  it('never exposes the token through the adapter object', () => {
    const adapter = new DuffelAdapter({ accessToken: TOKEN });
    expect(JSON.stringify(adapter)).not.toContain(TOKEN);
    expect(Object.values(adapter).join()).not.toContain(TOKEN);
  });
});
