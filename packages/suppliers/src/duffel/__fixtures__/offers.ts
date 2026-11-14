// Trimmed but realistic Duffel test-mode payloads (field names/values as Duffel returns them).
// Typed against the SDK so a renamed field in a future SDK version breaks the build here.
import type { DuffelOffer } from '../duffel.mapper.js';

type Segment = DuffelOffer['slices'][number]['segments'][number];
type Slice = DuffelOffer['slices'][number];

const airline = (iata: string, name: string) => ({
  id: `arl_${iata}`,
  iata_code: iata,
  name,
  logo_lockup_url: `https://assets.duffel.com/img/airlines/for-light-background/full-color-lockup/${iata}.svg`,
  logo_symbol_url: `https://assets.duffel.com/img/airlines/for-light-background/full-color-logo/${iata}.svg`,
  conditions_of_carriage_url: null,
});

const airport = (iata: string, name: string, tz: string) => ({
  type: 'airport' as const,
  id: `arp_${iata.toLowerCase()}`,
  iata_code: iata,
  icao_code: `X${iata}`,
  name,
  city_name: name,
  city: null,
  iata_city_code: iata,
  iata_country_code: 'GB',
  latitude: 0,
  longitude: 0,
  time_zone: tz,
});

const LHR = airport('LHR', 'Heathrow', 'Europe/London');
const JFK = airport('JFK', 'John F. Kennedy International', 'America/New_York');
const DUB = airport('DUB', 'Dublin', 'Europe/Dublin');
const ZZ = airline('ZZ', 'Duffel Airways');

function segment(
  id: string,
  origin: typeof LHR,
  destination: typeof LHR,
  departing: string,
  arriving: string,
  duration: string,
  terminals: [string | null, string | null],
  baggages: Array<{ type: 'checked' | 'carry_on'; quantity: number }>,
): Segment {
  return {
    id,
    origin,
    destination,
    origin_terminal: terminals[0],
    destination_terminal: terminals[1],
    departing_at: departing,
    arriving_at: arriving,
    duration,
    distance: '5554.0',
    aircraft: { id: 'arc_00009VMF8AhXSSRnQDI6Hi', iata_code: '388', name: 'Airbus Industrie A380-800' },
    marketing_carrier: ZZ,
    marketing_carrier_flight_number: '0117',
    operating_carrier: ZZ,
    operating_carrier_flight_number: '0117',
    stops: [],
    passengers: [
      {
        passenger_id: 'pas_0000AUde3KY1SptM6ABSfU',
        cabin_class: 'economy',
        cabin_class_marketing_name: 'Economy',
        fare_basis_code: 'Y20LGTN2',
        baggages,
        cabin: null,
      },
    ],
  } as Segment;
}

function slice(id: string, origin: typeof LHR, destination: typeof LHR, duration: string | null,
  segments: Segment[], fareBrand: string | null): Slice {
  return {
    id,
    origin,
    origin_type: 'airport',
    destination,
    destination_type: 'airport',
    duration,
    fare_brand_name: fareBrand,
    segments,
    conditions: {
      change_before_departure: null,
      refund_before_departure: null,
      advance_seat_selection: null,
      priority_boarding: null,
      priority_check_in: null,
    },
    ngs_shelf: 1,
    comparison_key: 'abc',
  } as Slice;
}

const outbound = slice(
  'sli_out',
  LHR,
  JFK,
  'PT7H50M',
  [
    segment('seg_1', LHR, JFK, '2026-12-14T10:15:00', '2026-12-14T13:05:00', 'PT7H50M', ['5', '4'], [
      { type: 'checked', quantity: 1 },
      { type: 'carry_on', quantity: 1 },
    ]),
  ],
  'Basic',
);

function offer(id: string, slices: Slice[], overrides: Partial<DuffelOffer> = {}): DuffelOffer {
  return {
    id,
    live_mode: false,
    created_at: '2026-11-14T12:00:00.000000Z',
    updated_at: '2026-11-14T12:00:00.000000Z',
    expires_at: '2099-11-14T12:30:00.000000Z',
    owner: ZZ,
    slices,
    passengers: [
      { id: 'pas_0000AUde3KY1SptM6ABSfU', type: 'adult', age: null, fare_type: null },
    ],
    total_amount: '512.34',
    total_currency: 'GBP',
    base_amount: '420.00',
    base_currency: 'GBP',
    tax_amount: '92.34',
    tax_currency: 'GBP',
    total_emissions_kg: '460',
    conditions: {
      refund_before_departure: { allowed: false, penalty_amount: null, penalty_currency: null },
      change_before_departure: null,
    },
    payment_requirements: {
      requires_instant_payment: false,
      price_guarantee_expires_at: '2026-11-16T12:00:00Z',
      payment_required_by: '2026-11-17T12:00:00Z',
    },
    passenger_identity_documents_required: false,
    private_fares: [],
    partial: false,
    supported_loyalty_programmes: [],
    supported_passenger_identity_document_types: ['passport'],
    ...overrides,
  } as DuffelOffer;
}

export const oneWayOffer = offer('off_0000AUde3KY1SptM6ABSfT', [outbound]);

export const returnOffer = offer(
  'off_0000AUde3KY1SptM6ABSfR',
  [
    outbound,
    slice(
      'sli_ret',
      JFK,
      LHR,
      'PT9H45M',
      [
        segment('seg_2', JFK, DUB, '2026-12-21T18:00:00', '2026-12-22T05:30:00', 'PT6H30M', [null, '2'], []),
        segment('seg_3', DUB, LHR, '2026-12-22T07:00:00', '2026-12-22T08:15:00', 'PT1H15M', ['2', '2'], []),
      ],
      null,
    ),
  ],
  {
    total_amount: '980.10',
    base_amount: '800.00',
    tax_amount: null,
    tax_currency: null,
    conditions: {
      refund_before_departure: null,
      change_before_departure: { allowed: true, penalty_amount: '50.00', penalty_currency: 'GBP' },
    },
    payment_requirements: {
      requires_instant_payment: true,
      price_guarantee_expires_at: null,
      payment_required_by: null,
    },
  },
);
