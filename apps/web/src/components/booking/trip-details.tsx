import type { PublicFlightOffer } from '@ota/contracts';
import { ChevronDown } from 'lucide-react';
import { AirlineLogo } from '@/components/offer/airline-logo';
import { SegmentTimeline, type AirportNames } from '@/components/offer/segment-timeline';
import { formatLocalDate } from '@/lib/local-time';
import { messages } from '@/lib/messages';

/**
 * Every slice of an offer: route, date, duration/stops, then each segment (flight number, aircraft,
 * airport names + terminals, operated-by), and the fare's baggage / change / refund conditions.
 */
export function TripDetails({ offer, airports }: { offer: PublicFlightOffer; airports?: AirportNames }) {
  const cityOrCode = (code: string) => airports?.[code]?.city ?? code;
  return (
    <div className="flex flex-col gap-5">
      {offer.slices.map((slice, i) => (
        <section key={`${slice.origin}-${slice.departureAt}`} aria-labelledby={`trip-slice-${i}`} className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <AirlineLogo carrier={slice.segments[0]?.marketingCarrier ?? offer.owner} />
            <div className="min-w-0">
              <h3 id={`trip-slice-${i}`} className="font-semibold">
                {i === 0 ? messages.offer.outbound : messages.offer.return}: {cityOrCode(slice.origin)} → {cityOrCode(slice.destination)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {formatLocalDate(slice.departureAt, 'weekday')} · {messages.offer.duration(slice.durationMinutes)} ·{' '}
                {messages.trip.stops(slice.stops)}
              </p>
            </div>
          </div>
          <SegmentTimeline slice={slice} airports={airports} />
        </section>
      ))}
      <ul className="grid gap-1 rounded-lg bg-muted p-3 text-sm sm:grid-cols-2">
        {offer.fareBrand && (
          <li>
            {messages.trip.fareBrand}: <span className="font-medium">{offer.fareBrand}</span>
          </li>
        )}
        <li>
          {offer.baggage?.checkedPieces === undefined
            ? `${messages.details.baggage}: ${messages.offer.unknownPolicy}`
            : offer.baggage.checkedPieces > 0
              ? messages.offer.checkedBag(offer.baggage.checkedPieces, offer.baggage.checkedWeightKg)
              : messages.offer.noCheckedBag}
        </li>
        {offer.baggage?.cabinPieces !== undefined && <li>{messages.offer.cabinBag(offer.baggage.cabinPieces)}</li>}
        <li>
          {offer.refundable === null
            ? `${messages.offer.refundable}: ${messages.offer.unknownPolicy}`
            : offer.refundable
              ? messages.offer.refundable
              : messages.offer.nonRefundable}
        </li>
        <li>
          {offer.changeable === null
            ? `${messages.offer.changeable}: ${messages.offer.unknownPolicy}`
            : offer.changeable
              ? messages.offer.changeable
              : messages.offer.nonChangeable}
        </li>
      </ul>
    </div>
  );
}

/** Collapsed by default (native <details>: keyboard + screen-reader support without JS). */
export function CollapsibleTrip({ offer, airports }: { offer: PublicFlightOffer; airports?: AirportNames }) {
  const first = offer.slices[0];
  const last = offer.slices[offer.slices.length - 1];
  const route = `${first.origin} → ${offer.slices.length > 1 ? `${first.destination} → ${last.destination}` : first.destination}`;
  return (
    <details className="group rounded-xl border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-semibold">{route}</span>
          <span className="block text-sm text-muted-foreground">
            {formatLocalDate(first.departureAt, 'weekday')} · {offer.owner.name}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
          {messages.trip.showFlights}
          <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t p-4">
        <TripDetails offer={offer} airports={airports} />
      </div>
    </details>
  );
}
