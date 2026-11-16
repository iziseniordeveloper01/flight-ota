import { offerIdSchema, type PublicPricedOffer } from '@ota/contracts';
import { AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckoutButton } from '@/components/booking/checkout-button';
import { PriceRows, type PriceRow } from '@/components/booking/price-rows';
import { TripDetails } from '@/components/booking/trip-details';
import { DemoNote } from '@/components/booking/booking-summary';
import { Button } from '@/components/ui/button';
import { searchUrlForOffer } from '@/lib/booking-steps';
import { messages } from '@/lib/messages';
import { formatMoney } from '@/lib/money-format';
import { airportNames, getOfferForPage } from '@/server/booking-api';

export const metadata: Metadata = { title: messages.trip.title, robots: { index: false, follow: false } };

function priceRows(offer: PublicPricedOffer): PriceRow[] {
  const { base, taxes, total } = offer.price;
  return [
    ...(offer.price.perPassenger ?? []).map((p) => ({ label: `${messages.passengerType[p.type]} × ${p.count}`, amount: p.total })),
    ...(base ? [{ label: messages.trip.fare, amount: base }] : []),
    ...(taxes ? [{ label: messages.details.taxes, amount: taxes }] : []),
    { label: messages.details.total, amount: total, strong: true },
  ];
}

export default async function TripSummaryPage({ searchParams }: PageProps<'/flights/confirm'>) {
  const { offer: raw } = await searchParams;
  const offerId = typeof raw === 'string' && offerIdSchema.safeParse(raw).success ? raw : null;
  const result = offerId ? await getOfferForPage(offerId) : null;

  if (!offerId || !result) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-10 text-center">
          <AlertTriangle aria-hidden className="size-8 text-warning-foreground" />
          <h1 className="text-xl font-semibold">{offerId ? messages.trip.expiredTitle : messages.trip.invalidOffer}</h1>
          {offerId && <p className="text-sm text-muted-foreground">{messages.trip.expiredBody}</p>}
          <Button asChild className="mt-2">
            <Link href="/">{messages.trip.searchAgain}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const offer = result.data;
  const airports = await airportNames(offer.slices.flatMap((s) => s.segments.flatMap((x) => [x.origin, x.destination])));
  const travellers = offer.passengers.length;
  const searchUrl = searchUrlForOffer(offer);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 pb-32 lg:pb-10">
      <h1 className="mb-3 text-2xl font-bold">{messages.trip.title}</h1>
      <div className="flex flex-col gap-3">
        {result.meta.demo && <DemoNote>{messages.booking.demoNote}</DemoNote>}
        {offer.priceChanged && offer.previousTotal && (
          <output className="block rounded-lg bg-warning p-3 font-medium text-warning-foreground">
            {messages.details.priceUpdated(formatMoney(offer.previousTotal), formatMoney(offer.price.total))}
          </output>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <section aria-labelledby="flights-h" className="rounded-xl border bg-card p-4 md:p-5">
          <h2 id="flights-h" className="mb-4 text-lg font-semibold">
            {messages.trip.flights}
          </h2>
          <TripDetails offer={offer} airports={airports} />
        </section>

        <aside aria-labelledby="price-h" className="rounded-xl border bg-card p-4 md:p-5 lg:sticky lg:top-4">
          <h2 id="price-h" className="mb-3 text-lg font-semibold">
            {messages.trip.priceDetail}
          </h2>
          <PriceRows rows={priceRows(offer)} />
          <p className="mt-2 text-sm text-muted-foreground">
            {messages.trip.travellers}: {messages.pax.travellers(travellers)} · {messages.trip.taxesIncluded}
          </p>
          <CheckoutButton offerId={offer.id} searchUrl={searchUrl} className="mt-4 hidden lg:flex" />
          <Link href={searchUrl} className="mt-3 hidden min-h-11 items-center justify-center text-sm font-medium text-primary underline-offset-4 hover:underline lg:flex">
            {messages.booking.backToResults}
          </Link>
        </aside>
      </div>

      {/* Phones: total + Checkout always in reach. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card px-4 py-3 shadow-[0_-4px_16px_rgb(0_0_0/0.06)] lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold tabular-nums">{formatMoney(offer.price.total)}</p>
            <p className="text-xs text-muted-foreground">{messages.offer.totalFor(travellers)}</p>
          </div>
          <CheckoutButton offerId={offer.id} searchUrl={searchUrl} className="w-44" />
        </div>
      </div>
    </div>
  );
}
