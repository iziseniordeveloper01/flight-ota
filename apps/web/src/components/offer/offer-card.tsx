import type { PublicFlightOffer, Slice } from '@ota/contracts';
import { Briefcase } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { dayDiff, formatLocalTime } from '@/lib/local-time';
import { messages } from '@/lib/messages';
import { formatMoney } from '@/lib/money-format';
import { AirlineLogo } from './airline-logo';
import { OperatedByNote } from './operated-by-note';
import { PriceLabel } from './price-label';

export function stopsText(slice: Slice): string {
  if (slice.stops === 0) return messages.offer.direct;
  const via = slice.segments
    .slice(0, -1)
    .map((s) => s.destination)
    .join(', ');
  return `${messages.offer.stops(slice.stops)}${via ? ` · ${messages.offer.via(via)}` : ''}`;
}

export function DayMarker({ from, to }: { from: string; to: string }) {
  const days = dayDiff(from, to);
  if (days <= 0) return null;
  return (
    <sup className="ml-0.5 text-xs font-semibold text-destructive">
      <span aria-hidden>{messages.offer.nextDay(days)}</span>
      <span className="sr-only"> ({messages.offer.nextDayLabel(days)})</span>
    </sup>
  );
}

function SliceRow({ slice, label }: { slice: Slice; label?: string }) {
  return (
    <div>
      {label && <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
        <div>
          <p className="text-lg font-semibold tabular-nums">{formatLocalTime(slice.departureAt)}</p>
          <p className="text-sm text-muted-foreground">{slice.origin}</p>
        </div>
        <div className="flex min-w-0 flex-col items-center text-center">
          <p className="text-xs text-muted-foreground">{messages.offer.duration(slice.durationMinutes)}</p>
          <div aria-hidden className="my-1 h-px w-full bg-border" />
          <p
            className={
              slice.stops === 0
                ? 'text-xs font-medium text-success'
                : 'truncate text-xs text-muted-foreground'
            }
          >
            {stopsText(slice)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums">
            {formatLocalTime(slice.arrivalAt)}
            <DayMarker from={slice.departureAt} to={slice.arrivalAt} />
          </p>
          <p className="text-sm text-muted-foreground">{slice.destination}</p>
        </div>
      </div>
    </div>
  );
}

interface Props {
  offer: PublicFlightOffer;
  travellers: number;
  onSelect: (offer: PublicFlightOffer) => void;
}

export function OfferCard({ offer, travellers, onSelect }: Props) {
  const titleId = `offer-${offer.id}-title`;
  const roundTrip = offer.slices.length > 1;
  const bag = offer.baggage;
  // Compact below md (~3 cards per phone screen): fare brand and "changes" live in the details sheet.
  return (
    <article
      aria-labelledby={titleId}
      data-testid="offer-card"
      className="rounded-xl border bg-card p-3 shadow-xs md:p-4"
    >
      <header className="mb-2 flex items-center gap-2 md:mb-3">
        <AirlineLogo carrier={offer.owner} />
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="truncate text-sm font-semibold">
            {offer.owner.name}
          </h3>
          <OperatedByNote offer={offer} className="truncate" />
        </div>
        {offer.fareBrand && (
          <span className="hidden max-w-[40%] truncate text-xs text-muted-foreground md:inline">{offer.fareBrand}</span>
        )}
      </header>

      <div className="flex flex-col gap-2 md:gap-3">
        {offer.slices.map((slice, i) => (
          <SliceRow
            key={`${slice.origin}-${slice.departureAt}`}
            slice={slice}
            label={roundTrip ? (i === 0 ? messages.offer.outbound : messages.offer.return) : undefined}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 md:mt-3">
        {bag?.checkedPieces !== undefined && (
          <Badge variant="outline" className="gap-1">
            <Briefcase aria-hidden className="size-3.5" />
            {bag.checkedPieces > 0
              ? messages.offer.checkedBag(bag.checkedPieces, bag.checkedWeightKg)
              : messages.offer.noCheckedBag}
          </Badge>
        )}
        {offer.refundable !== null && (
          <Badge variant="outline">
            {offer.refundable ? messages.offer.refundable : messages.offer.nonRefundable}
          </Badge>
        )}
        {offer.changeable !== null && (
          <Badge variant="outline" className="hidden md:inline-flex">
            {offer.changeable ? messages.offer.changeable : messages.offer.nonChangeable}
          </Badge>
        )}
      </div>

      <footer className="mt-2 flex items-center justify-between gap-3 border-t pt-2 md:mt-3 md:pt-3">
        <PriceLabel total={offer.displayPrice.total} travellers={travellers} />
        <Button
          onClick={() => onSelect(offer)}
          aria-label={messages.offer.selectLabel(offer.owner.name, formatMoney(offer.displayPrice.total))}
          className="shrink-0 px-6"
        >
          {messages.offer.select}
        </Button>
      </footer>
    </article>
  );
}
