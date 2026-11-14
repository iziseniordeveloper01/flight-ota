import { describe, expect, it, vi } from 'vitest';
import { SupplierError } from '../errors.js';
import type { CreateOrderInput, OrderLookup } from '../types.js';
import { confirmedOrder, offerWithServices, PAX_ADULT, PAX_INFANT, seatMaps } from './__fixtures__/booking.js';
import { DuffelAdapter } from './duffel.adapter.js';

const TOKEN = 'duffel_test_SECRET_DO_NOT_LEAK';
const OFFER_ID = offerWithServices.id;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const duffelError = (status: number, type: string, code: string) =>
  json(status, { meta: { status, request_id: 'req_9' }, errors: [{ type, code, title: 'Err', message: 'm' }] });

// Routes by URL so parallel calls (offer + seat maps) each get their payload. No network.
function adapterWith(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace('https://api.duffel.com', '');
    const key = `${init?.method ?? 'GET'} ${path.split('?')[0]}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected ${key}`);
    return handler();
  });
  return { adapter: new DuffelAdapter({ accessToken: TOKEN, fetch: fetchMock as typeof fetch }), fetchMock };
}

async function errorOf(promise: Promise<unknown>): Promise<SupplierError> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(SupplierError);
  return err as SupplierError;
}

const offerRoute = { [`GET /air/offers/${OFFER_ID}`]: () => json(200, { data: offerWithServices }) };
const seatRoute = { 'GET /air/seat_maps': () => json(200, { data: seatMaps }) };

const orderInput: CreateOrderInput = {
  supplierOfferId: OFFER_ID,
  supplierRef: {},
  passengers: [
    {
      ref: PAX_ADULT, type: 'adult', title: 'mr', gender: 'm', givenName: 'Sukarno', familyName: null,
      dateOfBirth: '1980-02-01', nationality: 'ID',
      document: { type: 'passport', number: 'X1234567', issuingCountry: 'ID', expiryDate: '2030-01-01' },
    },
    {
      ref: PAX_INFANT, type: 'infant', title: 'miss', gender: 'f', givenName: 'Ana', familyName: 'Lee',
      dateOfBirth: '2026-01-01', nationality: 'GB', associatedAdultRef: PAX_ADULT,
    },
  ],
  contact: { email: 'guest@example.com', phone: '+442080160509' },
  services: [{ serviceId: 'ase_00009UhD4ongolulWd9123', quantity: 1 }, { serviceId: 'ase_seat_14A', quantity: 1 }],
  expectedTotal: { amount: '557.34', currency: 'GBP' },
  idempotencyKey: '01936d7e-booking',
};

describe('DuffelAdapter.getAncillaries', () => {
  it('maps baggage services (not CFAR), seat availability and passenger requirements', async () => {
    const { adapter, fetchMock } = adapterWith({ ...offerRoute, ...seatRoute });
    const result = await adapter.getAncillaries(OFFER_ID);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(`https://api.duffel.com/air/offers/${OFFER_ID}?return_available_services=true`);
    expect(urls).toContain(`https://api.duffel.com/air/seat_maps?offer_id=${OFFER_ID}`);
    for (const call of fetchMock.mock.calls) expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);

    expect(result.bags).toEqual([
      {
        serviceId: 'ase_00009UhD4ongolulWd9123', passengerRef: PAX_ADULT, segmentRefs: ['seg_1'],
        label: '23kg checked bag', weightKg: 23, maxQuantity: 2, price: { amount: '30.00', currency: 'GBP' },
      },
      {
        serviceId: 'ase_00009UhD4ongolulWd9cab', passengerRef: PAX_ADULT, segmentRefs: ['seg_1'],
        label: 'cabin bag', weightKg: undefined, maxQuantity: 1, price: { amount: '12.50', currency: 'GBP' },
      },
    ]);
    expect(result.seatsAvailable).toBe(true);
    expect(result.passengerRequirements).toEqual({ identityDocumentRequired: true, maxNameLength: 20 });
  });

  it('no seat maps → seatsAvailable false', async () => {
    const { adapter } = adapterWith({ ...offerRoute, 'GET /air/seat_maps': () => json(200, { data: [] }) });
    expect((await adapter.getAncillaries(OFFER_ID)).seatsAvailable).toBe(false);
  });

  it('expired offer → OFFER_EXPIRED', async () => {
    const { adapter } = adapterWith({
      [`GET /air/offers/${OFFER_ID}`]: () => json(200, { data: { ...offerWithServices, expires_at: '2020-01-01T00:00:00Z' } }),
      ...seatRoute,
    });
    expect((await errorOf(adapter.getAncillaries(OFFER_ID))).code).toBe('OFFER_EXPIRED');
  });
});

describe('DuffelAdapter.getSeatMaps', () => {
  it('normalizes rows, seats, gaps, exits and facilities', async () => {
    const { adapter } = adapterWith(seatRoute);
    const [map] = await adapter.getSeatMaps(OFFER_ID);
    expect(map.segmentRef).toBe('seg_1');
    const rows = map.cabins[0].rows;
    expect(rows.map((r) => r.number)).toEqual([null, 14, null, 15]);
    expect(rows[0].sections.map((s) => s.elements[0])).toEqual([
      { type: 'facility', kind: 'lavatory' },
      { type: 'facility', kind: 'galley' },
    ]);
    expect(rows[1].sections[0].elements).toEqual([
      {
        type: 'seat', designator: '14A', available: true, name: 'Window',
        services: [{ passengerRef: PAX_ADULT, serviceId: 'ase_seat_14A', price: { amount: '15.00', currency: 'GBP' } }],
      },
      { type: 'seat', designator: '14B', available: false, services: [] },
    ]);
    expect(rows[1].sections[1].elements[0]).toEqual({ type: 'gap' });
    expect(rows[2].sections[0].elements[0]).toEqual({ type: 'exit' });
    expect(rows[3].sections[0].elements[0]).toMatchObject({ disclosures: ['Must be able to assist'] });
    expect(rows[3].sections[1].elements[0]).toEqual({ type: 'facility', kind: 'bassinet' });
  });
});

describe('DuffelAdapter.createOrder', () => {
  it('sends an instant balance order with metadata, infant link, documents and the mononym convention', async () => {
    const { adapter, fetchMock } = adapterWith({ 'POST /air/orders': () => json(201, { data: confirmedOrder }) });
    const result = await adapter.createOrder(orderInput, { timeoutMs: 130_000 });

    expect(result).toEqual({
      supplierOrderId: 'ord_0000AUdeConfirmed', pnr: 'RZPNX8', status: 'confirmed',
      total: { amount: '557.34', currency: 'GBP' },
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string).data;
    expect(body).toMatchObject({
      type: 'instant',
      selected_offers: [OFFER_ID],
      services: [{ id: 'ase_00009UhD4ongolulWd9123', quantity: 1 }, { id: 'ase_seat_14A', quantity: 1 }],
      payments: [{ type: 'balance', amount: '557.34', currency: 'GBP' }],
      metadata: { ota_booking_id: '01936d7e-booking' },
    });
    const [adult, infant] = body.passengers;
    expect(adult).toMatchObject({
      id: PAX_ADULT, title: 'mr', gender: 'm', given_name: 'Sukarno',
      family_name: 'Sukarno', // mononym → given name repeated (Duffel convention)
      born_on: '1980-02-01', email: 'guest@example.com', phone_number: '+442080160509',
      infant_passenger_id: PAX_INFANT,
      identity_documents: [{ type: 'passport', unique_identifier: 'X1234567', issuing_country_code: 'ID', expires_on: '2030-01-01' }],
    });
    expect(infant).not.toHaveProperty('infant_passenger_id');
    expect(infant).not.toHaveProperty('identity_documents');
  });

  it('no booking_reference yet → pending', async () => {
    const { adapter } = adapterWith({
      'POST /air/orders': () => json(201, { data: { ...confirmedOrder, booking_reference: '' } }),
    });
    expect(await adapter.createOrder(orderInput)).toMatchObject({ status: 'pending', pnr: null });
  });

  it('price_changed → PRICE_CHANGED with the re-read offer + services total', async () => {
    const { adapter } = adapterWith({
      'POST /air/orders': () => duffelError(422, 'airline_error', 'price_changed'),
      ...offerRoute,
      ...seatRoute,
    });
    const err = await errorOf(adapter.createOrder({ ...orderInput, expectedTotal: { amount: '500.00', currency: 'GBP' } }));
    expect(err.code).toBe('PRICE_CHANGED');
    expect(err.newTotal).toEqual({ amount: '557.34', currency: 'GBP' }); // 512.34 + 30.00 + 15.00
    expect(err.message).not.toContain('Sukarno');
  });

  it('price_changed with a service gone → PRICE_CHANGED without newTotal', async () => {
    const { adapter } = adapterWith({
      'POST /air/orders': () => duffelError(422, 'airline_error', 'price_changed'),
      ...offerRoute,
      'GET /air/seat_maps': () => json(200, { data: [] }),
    });
    const err = await errorOf(adapter.createOrder(orderInput));
    expect(err.code).toBe('PRICE_CHANGED');
    expect(err.newTotal).toBeUndefined();
  });
});

describe('DuffelAdapter.retrieveOrder', () => {
  const lookup: OrderLookup = {
    idempotencyKey: '01936d7e-booking',
    leadPassenger: { givenName: 'Sukarno', familyName: null },
    expectedTotal: { amount: '557.34', currency: 'GBP' },
  };

  it('by supplierOrderId → GET the order', async () => {
    const { adapter, fetchMock } = adapterWith({
      'GET /air/orders/ord_0000AUdeConfirmed': () => json(200, { data: confirmedOrder }),
    });
    expect(await adapter.retrieveOrder({ ...lookup, supplierOrderId: 'ord_0000AUdeConfirmed' })).toMatchObject({
      pnr: 'RZPNX8', status: 'confirmed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('unknown or malformed order id → null', async () => {
    const { adapter, fetchMock } = adapterWith({
      'GET /air/orders/ord_missing': () => duffelError(404, 'invalid_request_error', 'not_found'),
    });
    expect(await adapter.retrieveOrder({ ...lookup, supplierOrderId: 'ord_missing' })).toBeNull();
    expect(await adapter.retrieveOrder({ ...lookup, supplierOrderId: '../offers' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('without an id → lists by lead passenger name (mononym convention) and matches metadata', async () => {
    const other = { ...confirmedOrder, id: 'ord_other', metadata: { ota_booking_id: 'someone-else' } };
    const { adapter, fetchMock } = adapterWith({ 'GET /air/orders': () => json(200, { data: [other, confirmedOrder] }) });
    expect(await adapter.retrieveOrder(lookup)).toMatchObject({ supplierOrderId: 'ord_0000AUdeConfirmed' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('passenger_name[]=Sukarno');

    const none = adapterWith({ 'GET /air/orders': () => json(200, { data: [other] }) });
    expect(await none.adapter.retrieveOrder(lookup)).toBeNull();
  });
});
