'use client';

import type { OfferPassenger, SeatMap, SeatMapElement, SeatMapRow } from '@ota/contracts';
import { Check, User } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { messages } from '@/lib/messages';
import { formatMoney, formatMoneyWords } from '@/lib/money-format';
import { isFree, seatPosition, seatStatus, type SeatElement, type SeatSelection, type SeatStatus } from '@/lib/seat-selection';
import { cn } from '@/lib/utils';

const STATUS_CLASS: Record<SeatStatus, string> = {
  free: 'border-primary bg-card text-primary hover:bg-accent',
  paid: 'border-seat-paid-border bg-seat-paid text-seat-paid-foreground hover:brightness-95',
  selected: 'border-primary bg-primary text-primary-foreground',
  taken: 'border-input bg-secondary text-muted-foreground',
  unavailable: 'border-transparent bg-muted text-muted-foreground/60 line-through',
};

// Fit-to-width: every row is a CSS grid with the same columns. Seat columns shrink with the
// available width down to 28px (WCAG 2.2 target size needs 24px) and grow up to 44px on wider
// screens, so a 3-4-3 wide-body fits a 360px phone without horizontal scrolling.
const NUMBER_COL = '1.25rem';
const SEAT_COL = 'minmax(1.75rem, 2.75rem)';
const AISLE_COL = 'minmax(0.5rem, 1.25rem)';

// The sticky header sits on the overlay's surface; the shadow covers the row gap below it so seats
// scrolling underneath never peek through.
const STICKY_TOP = 'sticky top-0 z-10 bg-popover shadow-[0_4px_0_0_var(--color-popover)]';
const ROW = 'grid w-full justify-center gap-x-0.5 md:gap-x-1';

const column = (designator: string) => designator.replace(/^\d+/, '');

const seatCount = (row: SeatMapRow) => row.sections.reduce((n, s) => n + s.elements.filter((e) => e.type === 'seat').length, 0);

// ---------------------------------------------------------------------------------------------
// Layout. A seat map is a fixed grid: segment + deck + row + section + column identifies every
// cell, so those are the React keys (rows without a number are keyed after the last numbered row).

interface CellView {
  key: string;
  el: SeatMapElement;
  ei: number;
  /** CSS grid placement within the row. */
  gridColumn: string;
}
interface RowView {
  key: string;
  row: SeatMapRow;
  cells: Array<CellView & { si: number }>;
}
interface CabinView {
  key: string;
  deck: number;
  /** grid-template-columns shared by the header and every row of this cabin. */
  template: string;
  header: Array<{ key: string; letter: string; gridColumn: string }> | null;
  rows: RowView[];
}

function layout(map: SeatMap): CabinView[] {
  return map.cabins.map((cabin) => {
    // Several cabins can share a deck (business + economy): their first row number tells them apart.
    const cabinKey = `${map.segmentRef}-${cabin.deck}-${cabin.rows.find((r) => r.number !== null)?.number ?? 'none'}`;

    // Columns per section = the most elements any row has there; sections are separated by an aisle.
    const counts: number[] = [];
    for (const row of cabin.rows) row.sections.forEach((s, si) => (counts[si] = Math.max(counts[si] ?? 0, s.elements.length)));
    const starts: number[] = [];
    let next = 2; // column 1 = row number
    const tracks = [NUMBER_COL];
    counts.forEach((count, si) => {
      if (si > 0) {
        tracks.push(AISLE_COL);
        next++;
      }
      starts.push(next);
      tracks.push(`repeat(${count}, ${SEAT_COL})`);
      next += count;
    });
    const place = (si: number, ei: number, span = 1) => `${starts[si] + ei} / span ${span}`;

    let lastNumber = 0;
    let unnumbered = 0;
    const rows = cabin.rows.map((row): RowView => {
      if (row.number !== null) {
        lastNumber = row.number;
        unnumbered = 0;
      } else {
        unnumbered++;
      }
      const key = row.number !== null ? `${cabinKey}-${row.number}` : `${cabinKey}-${lastNumber}+${unnumbered}`;
      return {
        key,
        row,
        cells: row.sections.flatMap((section, si) =>
          section.elements.map((el, ei) => ({
            key: `${key}-${si}-${ei}`,
            el,
            ei,
            si,
            // A lone galley / toilet / exit marker spans its whole section, so its label stays readable.
            gridColumn: section.elements.length === 1 && el.type !== 'seat' ? place(si, 0, counts[si]) : place(si, ei),
          })),
        ),
      };
    });

    // Column letters from the row with the most seats: the first row is often a bassinet / exit row
    // with seats missing, which would mislabel the columns.
    const widest = cabin.rows.filter((r) => r.number !== null).reduce<SeatMapRow | null>((best, r) => (!best || seatCount(r) > seatCount(best) ? r : best), null);
    const header =
      widest && seatCount(widest) > 0
        ? widest.sections.flatMap((s, si) =>
            s.elements.flatMap((e, ei) => (e.type === 'seat' ? [{ key: `${cabinKey}-h${si}-${ei}`, letter: column(e.designator), gridColumn: place(si, ei) }] : [])),
          )
        : null;

    return { key: cabinKey, deck: cabin.deck, template: tracks.join(' '), header, rows };
  });
}

/** Info line for the hovered / focused seat (pointer devices; on phones the bottom bar says it). */
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
 * One aircraft seat map: decks, rows, sections with aisles, exit rows and facilities. Seats fit the
 * width (28–44px); the column letters stay pinned at the top while the cabin scrolls, and every row
 * shows its number on the left. Each seat's label says position, price for the active passenger
 * and status; paid seats are tinted (see the legend).
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
  const cabins = layout(map);

  const cell = (row: SeatMapRow, { key, el, ei, si, gridColumn }: CellView & { si: number }) => {
    const style: CSSProperties = { gridColumn };
    if (el.type === 'gap') return null;
    if (el.type === 'exit') {
      return (
        <span key={key} style={style} className="flex items-center justify-center text-[10px] font-bold tracking-wide text-success uppercase">
          {messages.seats.exit}
        </span>
      );
    }
    if (el.type === 'facility') {
      return (
        <span key={key} style={style} title={messages.seats.facility[el.kind]} className="flex h-7 min-w-0 items-center justify-center truncate rounded-md bg-muted px-1 text-[10px] text-muted-foreground md:h-9">
          {messages.seats.facility[el.kind]}
        </span>
      );
    }
    const d = describe(row, si, ei, el);
    const disabled = d.status === 'unavailable' || d.status === 'taken';
    return (
      <button
        key={key}
        type="button"
        style={style}
        aria-label={d.label}
        aria-pressed={d.status === 'selected'}
        disabled={disabled}
        data-status={d.status}
        onClick={() => onToggle(el)}
        onFocus={() => setInspected(el.designator)}
        onMouseEnter={() => setInspected(el.designator)}
        className={cn(
          'flex aspect-square w-full items-center justify-center rounded-md border-2 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed md:text-xs',
          STATUS_CLASS[d.status],
        )}
      >
        {d.status === 'selected' ? <Check aria-hidden className="size-3.5 md:size-4" /> : d.status === 'taken' ? <User aria-hidden className="size-3.5 md:size-4" /> : column(el.designator)}
      </button>
    );
  };

  const grid = cabins.map((cabin, index) => {
    const template: CSSProperties = { gridTemplateColumns: cabin.template };
    return (
      <div key={cabin.key} className="flex flex-col gap-1">
        {cabins.length > 1 && <h4 className="mt-2 text-center text-sm font-semibold">{messages.seats.deck(cabin.deck)}</h4>}
        {cabin.header && (
          <div aria-hidden data-testid="seat-columns" style={template} className={cn(ROW, STICKY_TOP, 'py-1 text-xs font-semibold text-muted-foreground')}>
            {cabin.header.map(({ key, letter, gridColumn }) => (
              <span key={key} style={{ gridColumn }} className="text-center">
                {letter}
              </span>
            ))}
          </div>
        )}
        {index === 0 && (
          <p data-testid="seat-front" className="py-1 text-center text-xs font-medium text-muted-foreground">
            <span aria-hidden>▲ </span>
            {messages.seats.front}
          </p>
        )}
        {cabin.rows.map(({ key, row, cells }) => (
          <div key={key} style={template} className={cn(ROW, 'items-center')} data-testid={row.number ? `seat-row-${row.number}` : undefined}>
            <span aria-hidden data-testid={row.number ? 'seat-row-number' : undefined} className="pr-1 text-right text-[11px] tabular-nums text-muted-foreground md:text-xs" style={{ gridColumn: '1' }}>
              {row.number ?? ''}
            </span>
            {cells.map((c) => cell(row, c))}
          </div>
        ))}
      </div>
    );
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p aria-hidden className="hidden min-h-5 text-center text-sm font-medium md:block">
        {inspectedInfo ?? ''}
      </p>
      {/* The map's own scroller, so the sticky column letters work. Seats fit the width; the x
          overflow is only a safety net for unusually wide layouts. */}
      <div data-testid="seat-map-scroll" className="min-h-0 flex-1 overflow-auto overscroll-contain pb-2">
        {grid}
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
          <span aria-hidden className={cn('flex size-5 items-center justify-center rounded border-2', STATUS_CLASS[status])}>
            {status === 'selected' ? <Check className="size-3" /> : status === 'taken' ? <User className="size-3" /> : null}
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}
