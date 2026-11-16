'use client';

import type { OfferPassenger, SeatMap, SeatMapRow } from '@ota/contracts';
import { Check, User } from 'lucide-react';
import { Fragment, useState } from 'react';
import { messages } from '@/lib/messages';
import { formatMoney, formatMoneyWords } from '@/lib/money-format';
import { isFree, seatPosition, seatStatus, type SeatElement, type SeatSelection, type SeatStatus } from '@/lib/seat-selection';
import { cn } from '@/lib/utils';

const STATUS_CLASS: Record<SeatStatus, string> = {
  free: 'border-primary bg-card text-primary hover:bg-accent',
  paid: 'border-primary bg-accent text-accent-foreground hover:bg-primary/15',
  selected: 'border-primary bg-primary text-primary-foreground',
  taken: 'border-input bg-secondary text-muted-foreground',
  unavailable: 'border-transparent bg-muted text-muted-foreground/60 line-through',
};

const column = (designator: string) => designator.replace(/^\d+/, '');

const seatCount = (row: SeatMapRow) => row.sections.reduce((n, s) => n + s.elements.filter((e) => e.type === 'seat').length, 0);

/**
 * Column letters per section ("A B C | D E F"), from the row with the most seats: the first row is
 * often a bassinet / exit row with seats missing, which would mislabel the columns.
 */
function columnHeader(rows: SeatMapRow[]): string[][] | null {
  const row = rows.filter((r) => r.number !== null).reduce<SeatMapRow | null>((best, r) => (!best || seatCount(r) > seatCount(best) ? r : best), null);
  return row && seatCount(row) > 0 ? row.sections.map((s) => s.elements.map((e) => (e.type === 'seat' ? column(e.designator) : ''))) : null;
}

/** Info line for the hovered / focused seat. */
function inspect(
  map: SeatMap,
  designator: string,
  describe: (row: SeatMapRow, si: number, ei: number, seat: SeatElement) => { info: string },
): string | null {
  for (const row of map.cabins.flatMap((c) => c.rows)) {
    for (const [si, section] of row.sections.entries()) {
      for (const [ei, el] of section.elements.entries()) {
        if (el.type === 'seat' && el.designator === designator) return describe(row, si, ei, el).info;
      }
    }
  }
  return null;
}

interface Props {
  map: SeatMap;
  passenger: OfferPassenger;
  selection: SeatSelection;
  onToggle: (seat: SeatElement) => void;
}

/**
 * One aircraft seat map: decks, rows, sections with aisles as gaps, exit rows and facilities. Every
 * seat is a 44px button whose label says position, price for the active passenger and status.
 */
export function SeatGrid({ map, passenger, selection, onToggle }: Props) {
  const [inspected, setInspected] = useState<string | null>(null);

  const describe = (row: SeatMapRow, si: number, ei: number, seat: SeatElement) => {
    const { status, service } = seatStatus(seat, map.segmentRef, passenger.ref, selection);
    const position = messages.seats.position[seatPosition(row, si, ei)];
    const free = status === 'free' || (status === 'selected' && service !== undefined && isFree(service.price));
    const price = service && status !== 'taken' && status !== 'unavailable' ? (free ? messages.seats.priceFree : formatMoneyWords(service.price)) : null;
    const statusWord =
      status === 'selected' ? messages.seats.status.selected : status === 'taken' ? messages.seats.status.taken : status === 'unavailable' ? messages.seats.status.unavailable : messages.seats.status.available;
    return {
      status,
      label: messages.seats.seatAria(seat.designator, position, price, statusWord),
      info: [seat.designator, position, service && status !== 'unavailable' && status !== 'taken' ? (free ? messages.seats.free : formatMoney(service.price)) : statusWord, seat.name]
        .filter(Boolean)
        .join(' · '),
    };
  };

  const inspectedInfo = inspected ? inspect(map, inspected, describe) : null;

  const grid = map.cabins.map((cabin, ci) => {
    const header = columnHeader(cabin.rows);
    return (
      <div key={`${cabin.deck}-${ci}`} className="flex flex-col items-center gap-1">
        {map.cabins.length > 1 && <h4 className="mt-2 text-sm font-semibold">{messages.seats.deck(cabin.deck)}</h4>}
        {header && (
          <div aria-hidden className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            <span className="w-6" />
            {header.map((letters, si) => (
              <Fragment key={si}>
                {si > 0 && <span className="w-5" />}
                {letters.map((l, li) => (
                  <span key={li} className="w-11 text-center">
                    {l}
                  </span>
                ))}
              </Fragment>
            ))}
            <span className="w-6" />
          </div>
        )}
        {cabin.rows.map((row, ri) => (
          <div key={`${row.number ?? 'x'}-${ri}`} className="flex items-center gap-1" data-testid={row.number ? `seat-row-${row.number}` : undefined}>
            <span aria-hidden className="w-6 text-right text-xs tabular-nums text-muted-foreground">
              {row.number ?? ''}
            </span>
            {row.sections.map((section, si) => (
              <Fragment key={si}>
                {si > 0 && <span aria-hidden className="w-5" />}
                {section.elements.map((el, ei) => {
                  if (el.type === 'gap') return <span key={ei} aria-hidden className="size-11" />;
                  if (el.type === 'exit') {
                    return (
                      <span key={ei} className="flex h-11 w-11 items-center justify-center text-[10px] font-bold tracking-wide text-success uppercase">
                        {messages.seats.exit}
                      </span>
                    );
                  }
                  if (el.type === 'facility') {
                    return (
                      <span key={ei} title={messages.seats.facility[el.kind]} className="flex size-11 items-center justify-center rounded-md bg-muted text-[10px] text-muted-foreground">
                        {messages.seats.facility[el.kind]}
                      </span>
                    );
                  }
                  const d = describe(row, si, ei, el);
                  const disabled = d.status === 'unavailable' || d.status === 'taken';
                  return (
                    <button
                      key={ei}
                      type="button"
                      aria-label={d.label}
                      aria-pressed={d.status === 'selected'}
                      disabled={disabled}
                      data-status={d.status}
                      onClick={() => onToggle(el)}
                      onFocus={() => setInspected(el.designator)}
                      onMouseEnter={() => setInspected(el.designator)}
                      className={cn(
                        'relative flex size-11 items-center justify-center rounded-md border-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed',
                        STATUS_CLASS[d.status],
                      )}
                    >
                      {d.status === 'selected' ? <Check aria-hidden className="size-4" /> : d.status === 'taken' ? <User aria-hidden className="size-4" /> : column(el.designator)}
                      {d.status === 'paid' && <span aria-hidden className="absolute top-0.5 right-1 text-[9px] leading-none">$</span>}
                    </button>
                  );
                })}
              </Fragment>
            ))}
            <span aria-hidden className="w-6 text-xs tabular-nums text-muted-foreground">
              {row.number ?? ''}
            </span>
          </div>
        ))}
      </div>
    );
  });

  return (
    <div className="flex flex-col gap-2">
      <p aria-hidden className="min-h-5 text-center text-sm font-medium">
        {inspectedInfo ?? ''}
      </p>
      {/* Wide-body maps may exceed a phone's width: scroll inside the map, never the page. */}
      <div className="overflow-x-auto pb-2">
        <div className="mx-auto w-max">{grid}</div>
      </div>
    </div>
  );
}

export function SeatLegend() {
  const items: Array<[SeatStatus, string]> = [
    ['free', messages.seats.free],
    ['paid', messages.seats.paid],
    ['selected', messages.seats.selected],
    ['taken', messages.seats.takenByOther],
    ['unavailable', messages.seats.unavailable],
  ];
  return (
    <ul aria-label={messages.seats.legend} className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {items.map(([status, label]) => (
        <li key={status} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('relative flex size-5 items-center justify-center rounded border-2 text-[9px]', STATUS_CLASS[status])}>
            {status === 'paid' ? '$' : status === 'selected' ? <Check className="size-3" /> : status === 'taken' ? <User className="size-3" /> : ''}
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}
