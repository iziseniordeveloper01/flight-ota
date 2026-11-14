'use client';

import type { PublicFlightOffer, PublicPricedOffer } from '@ota/contracts';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ResponsiveDialog } from '@/components/responsive-overlay';
import { ErrorState } from '@/components/results/result-states';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import { formatLocalDate } from '@/lib/local-time';
import { messages } from '@/lib/messages';
import { formatMoney } from '@/lib/money-format';
import { AirlineLogo } from './airline-logo';
import { OperatedByNote } from './operated-by-note';
import { PriceLabel } from './price-label';
import { SegmentTimeline } from './segment-timeline';

interface Props {
  /** The offer picked from the list (shown immediately while the live re-price loads). */
  offer: PublicFlightOffer | null;
  travellers: number;
  onClose: () => void;
  /** 410: throw away the cached search and fetch fresh fares. */
  onRefreshSearch: () => void;
}

export function OfferDetailsSheet({ offer, travellers, onClose, onRefreshSearch }: Props) {
  return (
    <ResponsiveDialog
      open={offer !== null}
      onOpenChange={(open) => !open && onClose()}
      title={messages.details.title}
      footer={
        <div className="flex flex-col gap-1">
          <Button size="lg" className="w-full" disabled aria-describedby="booking-soon">
            {messages.details.continue}
          </Button>
          <p id="booking-soon" className="text-center text-sm text-muted-foreground">
            {messages.details.comingSoon}
          </p>
        </div>
      }
    >
      {/* key: a different offer gets a fresh query/state. */}
      {offer && <Details key={offer.id} listed={offer} travellers={travellers} onRefreshSearch={onRefreshSearch} />}
    </ResponsiveDialog>
  );
}

function Details({
  listed,
  travellers,
  onRefreshSearch,
}: {
  listed: PublicFlightOffer;
  travellers: number;
  onRefreshSearch: () => void;
}) {
  const query = useQuery({
    queryKey: ['offer', listed.id],
    queryFn: ({ signal }) => api.getOffer(listed.id, signal),
    staleTime: 0, // always re-price on open: that is the point of this call
    gcTime: 0,
  });

  const error = query.error instanceof ApiError ? query.error : null;
  if (error?.kind === 'expired') {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center">
        <AlertTriangle aria-hidden className="size-8 text-warning-foreground" />
        <p className="text-lg font-semibold">{messages.errors.expired}</p>
        <p className="text-sm text-muted-foreground">{messages.details.expiredBody}</p>
        <Button onClick={onRefreshSearch}>{messages.details.refresh}</Button>
      </div>
    );
  }

  const priced: PublicPricedOffer | undefined = query.data?.data;
  const offer = priced ?? listed;

  const cabin = offer.slices[0]?.segments[0]?.cabin;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <AirlineLogo carrier={offer.owner} />
        <div className="min-w-0">
          <p className="font-semibold">{offer.owner.name}</p>
          <OperatedByNote offer={offer} />
          <p className="text-sm text-muted-foreground">
            {[cabin && messages.cabin[cabin], offer.fareBrand].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      <section aria-live="polite" aria-busy={query.isPending}>
        {query.isPending && (
          <output className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">{messages.details.loading}</span>
            <Skeleton className="h-8 w-40" />
          </output>
        )}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />}
        {priced?.priceChanged && priced.previousTotal && (
          <div className="rounded-lg bg-warning p-3 text-warning-foreground">
            <p className="font-medium">
              {messages.details.priceUpdated(formatMoney(priced.previousTotal), formatMoney(priced.price.total))}
            </p>
          </div>
        )}
        {priced && !priced.priceChanged && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-success">
            <CheckCircle2 aria-hidden className="size-4" />
            {messages.details.priceConfirmed}
          </p>
        )}
        {priced && (
          <PriceLabel
            total={priced.price.total}
            travellers={travellers}
            className="mt-2"
            amountClassName={priced.priceChanged ? 'rounded bg-accent px-1.5 text-2xl text-accent-foreground' : 'text-2xl'}
          />
        )}
      </section>

      {offer.slices.map((slice, i) => (
        <section key={`${slice.origin}-${slice.departureAt}`} aria-labelledby={`slice-${i}`}>
          <h3 id={`slice-${i}`} className="mb-2 font-semibold">
            {offer.slices.length > 1 ? (i === 0 ? messages.offer.outbound : messages.offer.return) : messages.offer.outbound}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {slice.origin} → {slice.destination} · {formatLocalDate(slice.departureAt, 'weekday')} ·{' '}
              {messages.offer.duration(slice.durationMinutes)}
            </span>
          </h3>
          <SegmentTimeline slice={slice} />
        </section>
      ))}

      <Separator />

      <section aria-labelledby="bags-h">
        <h3 id="bags-h" className="mb-1 font-semibold">
          {messages.details.baggage}
        </h3>
        <ul className="text-sm">
          <li>
            {offer.baggage?.checkedPieces === undefined
              ? messages.offer.unknownPolicy
              : offer.baggage.checkedPieces > 0
                ? messages.offer.checkedBag(offer.baggage.checkedPieces, offer.baggage.checkedWeightKg)
                : messages.offer.noCheckedBag}
          </li>
          {offer.baggage?.cabinPieces !== undefined && <li>{messages.offer.cabinBag(offer.baggage.cabinPieces)}</li>}
        </ul>
      </section>

      <section aria-labelledby="policy-h">
        <h3 id="policy-h" className="mb-1 font-semibold">
          {messages.details.policies}
        </h3>
        <ul className="text-sm">
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
      </section>

      {priced && (
        <section aria-labelledby="price-h">
          <h3 id="price-h" className="mb-1 font-semibold">
            {messages.details.priceBreakdown}
          </h3>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            {priced.price.perPassenger?.map((p) => (
              <Row key={p.type} label={`${messages.passengerType[p.type]} × ${p.count}`} value={formatMoney(p.total)} />
            ))}
            {priced.price.base && <Row label={messages.details.base} value={formatMoney(priced.price.base)} />}
            {priced.price.taxes && <Row label={messages.details.taxes} value={formatMoney(priced.price.taxes)} />}
            <Row label={messages.details.total} value={formatMoney(priced.price.total)} strong />
          </dl>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <dt className={strong ? 'font-semibold' : 'text-muted-foreground'}>{label}</dt>
      <dd className={strong ? 'text-right font-semibold tabular-nums' : 'text-right tabular-nums'}>{value}</dd>
    </>
  );
}
