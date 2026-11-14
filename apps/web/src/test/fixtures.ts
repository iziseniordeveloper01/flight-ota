import type { Carrier, PublicFlightOffer, Segment, Slice } from '@ota/contracts';

interface SliceSpec {
  from?: string;
  to?: string;
  depart?: string; // airport-local
  arrive?: string;
  minutes?: number;
  via?: string[];
  /** Operating carrier of every segment (codeshare); defaults to the marketing carrier M1. */
  operatedBy?: Carrier;
}

function slice({
  from = 'DEL',
  to = 'BOM',
  depart = '2026-12-15T08:00:00',
  arrive = '2026-12-15T10:10:00',
  minutes = 130,
  via = [],
  operatedBy = { code: 'M1', name: 'Mock Air One' },
}: SliceSpec): Slice {
  const points = [from, ...via, to];
  const segments: Segment[] = points.slice(0, -1).map((origin, i) => ({
    marketingCarrier: { code: 'M1', name: 'Mock Air One' },
    operatingCarrier: operatedBy,
    flightNumber: String(100 + i),
    origin,
    destination: points[i + 1],
    departureAt: depart,
    arrivalAt: arrive,
    durationMinutes: minutes,
    cabin: 'economy',
  }));
  return { origin: from, destination: to, departureAt: depart, arrivalAt: arrive, durationMinutes: minutes, stops: via.length, segments };
}

let seq = 0;

export function offer(
  opts: {
    amount?: string;
    currency?: string;
    owner?: string;
    refundable?: boolean | null;
    slices?: SliceSpec[];
  } = {},
): PublicFlightOffer {
  seq += 1;
  const owner = opts.owner ?? 'M1';
  return {
    id: `mock:o${seq}`,
    supplier: 'mock',
    supplierOfferId: `o${seq}`,
    expiresAt: '2026-12-01T00:00:00Z',
    price: { total: { amount: opts.amount ?? '100.00', currency: opts.currency ?? 'USD' } },
    owner: { code: owner, name: `Airline ${owner}` },
    slices: (opts.slices ?? [{}]).map(slice),
    refundable: opts.refundable ?? null,
    changeable: null,
    requiresInstantPayment: false,
  };
}
