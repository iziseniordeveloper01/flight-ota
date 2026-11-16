import type { Money } from '@ota/contracts';
import type { PriceBreakdown } from '@/lib/booking-price';
import { messages } from '@/lib/messages';
import { formatMoney } from '@/lib/money-format';
import { isFree } from '@/lib/seat-selection';
import { cn } from '@/lib/utils';

export interface PriceRow {
  label: string;
  amount: Money;
  strong?: boolean;
}

/** Label / amount list used by every price detail (trip summary, booking, review, complete). */
export function PriceRows({ rows, className }: { rows: PriceRow[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm', className)}>
      {rows.map((r) => (
        <div key={r.label} className={cn('contents', r.strong && 'text-base font-semibold')}>
          <dt className={r.strong ? 'border-t pt-2' : 'text-muted-foreground'}>{r.label}</dt>
          <dd className={cn('text-right tabular-nums', r.strong && 'border-t pt-2')}>{formatMoney(r.amount)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Fare, then only the extras that cost something, then the total. */
export function breakdownRows(p: PriceBreakdown): PriceRow[] {
  return [
    { label: messages.booking.fare, amount: p.fare },
    ...(isFree(p.baggage) ? [] : [{ label: messages.booking.baggageLine, amount: p.baggage }]),
    ...(isFree(p.seats) ? [] : [{ label: messages.booking.seatsLine, amount: p.seats }]),
    ...(isFree(p.insurance) ? [] : [{ label: messages.booking.insuranceLine, amount: p.insurance }]),
    { label: messages.booking.total, amount: p.total, strong: true },
  ];
}
