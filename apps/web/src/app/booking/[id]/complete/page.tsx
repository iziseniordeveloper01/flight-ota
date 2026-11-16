import { CheckCircle2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BookingStepper } from '@/components/booking/booking-stepper';
import { BookingSummary, DemoNote } from '@/components/booking/booking-summary';
import { PrintButton } from '@/components/booking/print-button';
import { Button } from '@/components/ui/button';
import { stepPathFor } from '@/lib/booking-steps';
import { messages } from '@/lib/messages';
import { getBookingForPage } from '@/server/booking-api';

export const metadata: Metadata = { title: messages.complete.title, robots: { index: false, follow: false } };

/** Step 3: confirmation with the airline PNR. Printable (header, footer and buttons hide). */
export default async function CompletePage({ params }: PageProps<'/booking/[id]/complete'>) {
  const { id } = await params;
  const booking = await getBookingForPage(id);
  if (booking.status !== 'CONFIRMED') redirect(stepPathFor(id, booking.status));

  return (
    <div className="mx-auto max-w-3xl px-4 pt-4 pb-10">
      <BookingStepper current={3} />
      <section aria-labelledby="done-h" className="mt-4 flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-8 text-center">
        <CheckCircle2 aria-hidden className="size-14 text-success" />
        <h1 id="done-h" className="text-2xl font-bold">
          {messages.complete.title}
        </h1>
        <dl className="mt-2 grid w-full max-w-md gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-accent p-3">
            <dt className="text-xs font-medium text-accent-foreground">{messages.complete.pnr}</dt>
            <dd className="text-2xl font-bold tracking-widest" data-testid="pnr">
              {booking.pnr}
            </dd>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <dt className="text-xs font-medium text-muted-foreground">{messages.complete.reference}</dt>
            <dd className="text-2xl font-bold tracking-widest" data-testid="booking-reference">
              {booking.reference}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">{messages.complete.saveReferences}</p>
        {booking.demo && <DemoNote>{messages.complete.demo}</DemoNote>}
      </section>

      <div className="mt-4">
        <BookingSummary booking={booking} />
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row print:hidden">
        <PrintButton />
        <Button asChild size="lg">
          <Link href="/">{messages.complete.bookAnother}</Link>
        </Button>
      </div>
    </div>
  );
}
