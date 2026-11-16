import type { Slice } from '@ota/contracts';
import { Fragment } from 'react';
import { isOperatedByOther } from '@/lib/codeshare';
import { formatLocalDate, formatLocalTime, minutesBetweenSameAirport } from '@/lib/local-time';
import { messages } from '@/lib/messages';
import { DayMarker } from './offer-card';

/** IATA code → display name (trip summary / booking pages). Optional: results show codes only. */
export type AirportNames = Record<string, { name: string; city?: string | null }>;

function Stop({
  time,
  refTime,
  airport,
  terminal,
  name,
}: {
  time: string;
  refTime: string;
  airport: string;
  terminal?: string;
  name?: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span aria-hidden className="relative top-0.5 size-3 shrink-0 rounded-full border-2 border-primary bg-card" />
      <p className="min-w-0">
        <span className="font-semibold tabular-nums">{formatLocalTime(time)}</span>
        <DayMarker from={refTime} to={time} />
        <span className="ml-2 font-semibold">{airport}</span>
        {terminal && <span className="ml-2 text-sm text-muted-foreground">{messages.details.terminal(terminal)}</span>}
        {name && <span className="block text-sm text-muted-foreground">{name}</span>}
        <span className="block text-xs text-muted-foreground">{formatLocalDate(time, 'weekday')}</span>
      </p>
    </div>
  );
}

/** Vertical timeline of one slice: each segment's departure → arrival, with connections between. */
export function SegmentTimeline({ slice, airports }: { slice: Slice; airports?: AirportNames }) {
  return (
    <ol className="flex flex-col gap-2">
      {slice.segments.map((seg, i) => {
        const next = slice.segments[i + 1];
        return (
          <Fragment key={`${seg.marketingCarrier.code}${seg.flightNumber}-${seg.departureAt}`}>
            <li className="flex flex-col gap-2">
              <Stop
                time={seg.departureAt}
                refTime={slice.departureAt}
                airport={seg.origin}
                terminal={seg.departureTerminal}
                name={airports?.[seg.origin]?.name}
              />
              <div className="ml-1.5 border-l-2 border-dashed border-border py-1 pl-5 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  {seg.marketingCarrier.name} · {messages.details.flight(seg.marketingCarrier.code, seg.flightNumber)}
                </p>
                <p>
                  {messages.offer.duration(seg.durationMinutes)}
                  {seg.aircraft ? ` · ${seg.aircraft}` : ''} · {messages.cabin[seg.cabin]}
                </p>
                {isOperatedByOther(seg) && (
                  <p className="text-xs">{messages.offer.operatedBy(seg.operatingCarrier.name)}</p>
                )}
              </div>
              <Stop
                time={seg.arrivalAt}
                refTime={slice.departureAt}
                airport={seg.destination}
                terminal={seg.arrivalTerminal}
                name={airports?.[seg.destination]?.name}
              />
            </li>
            {next && (
              <li className="my-1 rounded-md bg-muted px-3 py-2 text-sm">
                {messages.details.layover(
                  // Both times are local to the connecting airport, so subtracting them is valid.
                  messages.offer.duration(minutesBetweenSameAirport(seg.arrivalAt, next.departureAt)),
                  seg.destination,
                )}
              </li>
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
