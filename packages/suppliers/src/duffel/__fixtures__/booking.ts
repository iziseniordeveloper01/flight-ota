// Trimmed Duffel test-mode payloads for booking: offer with available_services, seat maps, order.
// Typed against the SDK so a renamed field in a future SDK version breaks the build here.
import type { Offer, Order, SeatMap } from '../duffel.types.js';
import { oneWayOffer } from './offers.js';

export const PAX_ADULT = 'pas_0000AUde3KY1SptM6ABSfU';
export const PAX_INFANT = 'pas_0000AUde3KY1SptM6ABSfI';

export const offerWithServices = {
  ...oneWayOffer,
  passenger_identity_documents_required: true,
  available_services: [
    {
      id: 'ase_00009UhD4ongolulWd9123',
      type: 'baggage',
      maximum_quantity: 2,
      passenger_ids: [PAX_ADULT],
      segment_ids: ['seg_1'],
      total_amount: '30.00',
      total_currency: 'GBP',
      metadata: { type: 'checked', maximum_weight_kg: 23, maximum_height_cm: null, maximum_length_cm: null, maximum_depth_cm: null },
    },
    {
      id: 'ase_00009UhD4ongolulWd9cab',
      type: 'baggage',
      maximum_quantity: 1,
      passenger_ids: [PAX_ADULT],
      segment_ids: ['seg_1'],
      total_amount: '12.50',
      total_currency: 'GBP',
      metadata: { type: 'carry_on', maximum_weight_kg: null, maximum_height_cm: null, maximum_length_cm: null, maximum_depth_cm: null },
    },
    {
      id: 'ase_cfar',
      type: 'cancel_for_any_reason',
      maximum_quantity: 1,
      passenger_ids: [PAX_ADULT],
      segment_ids: ['seg_1'],
      total_amount: '40.00',
      total_currency: 'GBP',
      metadata: { refund_amount: '400.00', merchant_copy: 'x', terms_and_conditions_url: 'https://example.com' },
    },
  ],
} as unknown as Offer;

const seat = (designator: string, services: Array<[string, string]>, extra: object = {}) => ({
  type: 'seat' as const,
  designator,
  disclosures: [],
  available_services: services.map(([id, amount]) => ({
    id,
    passenger_id: PAX_ADULT,
    total_amount: amount,
    total_currency: 'GBP',
  })),
  ...extra,
});

export const seatMaps = [
  {
    id: 'sea_1',
    slice_id: 'sli_out',
    segment_id: 'seg_1',
    cabins: [
      {
        deck: 0,
        cabin_class: 'economy',
        aisles: 1,
        wings: null,
        rows: [
          { sections: [{ elements: [{ type: 'lavatory' }] }, { elements: [{ type: 'galley' }] }] },
          {
            sections: [
              { elements: [seat('14A', [['ase_seat_14A', '15.00']], { name: 'Window' }), seat('14B', [])] },
              { elements: [{ type: 'empty' }, seat('14C', [['ase_seat_14C', '0.00']])] },
            ],
          },
          { sections: [{ elements: [{ type: 'exit_row' }] }, { elements: [{ type: 'exit_row' }] }] },
          {
            sections: [
              { elements: [seat('15A', [], { disclosures: ['Must be able to assist'] })] },
              { elements: [{ type: 'bassinet' }] },
            ],
          },
        ],
      },
    ],
  },
] as unknown as SeatMap[];

export const confirmedOrder = {
  id: 'ord_0000AUdeConfirmed',
  booking_reference: 'RZPNX8',
  total_amount: '557.34',
  total_currency: 'GBP',
  metadata: { ota_booking_id: '01936d7e-booking' },
} as unknown as Order;
