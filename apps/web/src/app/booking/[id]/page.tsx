import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BookingForm } from '@/components/booking/booking-form';
import { BookingStepper } from '@/components/booking/booking-stepper';
import { DemoNote } from '@/components/booking/booking-summary';
import { Countdown, ExpiredDialog } from '@/components/booking/countdown';
import { CollapsibleTrip } from '@/components/booking/trip-details';
import { searchUrlForOffer, stepPathFor } from '@/lib/booking-steps';
import { messages } from '@/lib/messages';
import { formatMoney } from '@/lib/money-format';
import { getAncillariesForPage, getBookingForPage } from '@/server/booking-api';

export const metadata: Metadata = { title: messages.booking.title, robots: { index: false, follow: false } };

/** Step 1: passengers, contact, extras. Booking + ancillaries are fetched here, server-side. */
export default async function BookingPage({ params, searchParams }: PageProps<'/booking/[id]'>) {
  const { id } = await params;
  const { was } = await searchParams;
  const booking = await getBookingForPage(id);
  if (booking.status !== 'DRAFT' && booking.status !== 'EXPIRED') redirect(stepPathFor(id, booking.status));

  const searchUrl = searchUrlForOffer(booking.offer);
  const ancillaries = booking.status === 'DRAFT' ? await getAncillariesForPage(id) : null;
  // ?was=<amount>: the fare (INR) changed when the booking was created (shown once).
  const previous = typeof was === 'string' && /^\d{1,10}(\.\d{1,3})?$/.test(was) ? { amount: was, currency: booking.displayPrice.currency } : null;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 pb-40 lg:pb-10">
      <BookingStepper current={1} />
      <h1 className="sr-only">{messages.booking.title}</h1>
      <div className="mt-4 flex flex-col gap-3">
        {ancillaries && <Countdown expiresAt={booking.expiresAt} searchUrl={searchUrl} />}
        {booking.demo && <DemoNote compact>{messages.booking.demoShort}</DemoNote>}
        {previous && (
          <output className="block rounded-lg bg-warning p-3 font-medium text-warning-foreground">
            {messages.booking.priceChanged(formatMoney(previous), formatMoney(booking.displayPrice.fare))}
          </output>
        )}
        <CollapsibleTrip offer={booking.offer} airports={booking.airports} />
      </div>
      <div className="mt-6">
        {ancillaries ? <BookingForm booking={booking} ancillaries={ancillaries} /> : <ExpiredDialog open searchUrl={searchUrl} />}
      </div>
    </div>
  );
}
