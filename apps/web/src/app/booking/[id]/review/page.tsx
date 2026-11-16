import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BookingStepper } from '@/components/booking/booking-stepper';
import { BookingSummary } from '@/components/booking/booking-summary';
import { ConfirmPanel } from '@/components/booking/confirm-panel';
import { stepPathFor } from '@/lib/booking-steps';
import { messages } from '@/lib/messages';
import { getBookingForPage } from '@/server/booking-api';

export const metadata: Metadata = { title: messages.review.title, robots: { index: false, follow: false } };

/** Step 2 ("Payment"): in this demo a read-only review + demo confirmation. */
export default async function ReviewPage({ params }: PageProps<'/booking/[id]/review'>) {
  const { id } = await params;
  const booking = await getBookingForPage(id);
  if (stepPathFor(id, booking.status) !== `/booking/${id}/review`) redirect(stepPathFor(id, booking.status));

  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 pb-10">
      <BookingStepper current={2} />
      <h1 className="mt-4 text-2xl font-bold">{messages.review.title}</h1>
      <p className="text-sm text-muted-foreground">
        {messages.booking.reference}: <span className="font-semibold text-foreground">{booking.reference}</span>
      </p>
      <div className="mt-4 flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-6">
        <BookingSummary booking={booking} />
        <div className="lg:sticky lg:top-4">
          <ConfirmPanel booking={booking} />
        </div>
      </div>
    </div>
  );
}
