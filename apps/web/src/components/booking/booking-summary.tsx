import type { PublicBooking } from '@ota/contracts';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { bookingBreakdown } from '@/lib/booking-price';
import { passengerLabels } from '@/lib/booking-steps';
import { countryName } from '@/lib/countries';
import { formatLocalDate } from '@/lib/local-time';
import { messages } from '@/lib/messages';
import { formatMoney } from '@/lib/money-format';
import { cn } from '@/lib/utils';
import { breakdownRows, PriceRows } from './price-rows';
import { TripDetails } from './trip-details';

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border bg-card p-4 break-inside-avoid md:p-5">
      <h2 id={id} className="mb-3 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function DemoNote({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <p
      role="note"
      className={cn(
        'flex gap-2 rounded-lg bg-warning text-warning-foreground',
        compact ? 'items-center px-3 py-1.5 text-xs font-medium' : 'items-start px-3 py-2 text-sm font-medium',
      )}
    >
      <Info aria-hidden className={cn('shrink-0', compact ? 'size-3.5' : 'mt-0.5 size-4')} />
      {children}
    </p>
  );
}

const fullName = (p: { title: keyof typeof messages.booking.titles; givenName: string; familyName: string | null }) =>
  [messages.booking.titles[p.title], p.givenName, p.familyName].filter(Boolean).join(' ');

/** Read-only booking (review + complete): flights, passengers, contact, extras, price. */
export function BookingSummary({ booking, showPrice = true }: { booking: PublicBooking; showPrice?: boolean }) {
  const labels = passengerLabels(booking.offer.passengers);
  const extras = booking.ancillaries.filter((a) => a.type !== 'insurance');
  const insurance = booking.ancillaries.find((a) => a.type === 'insurance');
  const segment = new Map(booking.offer.slices.flatMap((s) => s.segments).map((s) => [s.ref, `${s.origin} → ${s.destination}`]));

  return (
    <div className="flex flex-col gap-4">
      <Card id="sum-flights" title={messages.review.flights}>
        <TripDetails offer={booking.offer} airports={booking.airports} />
      </Card>

      <Card id="sum-passengers" title={messages.review.passengers}>
        <ul className="flex flex-col divide-y">
          {booking.passengers.map((p) => (
            <li key={p.ref} className="py-2 first:pt-0 last:pb-0">
              <p className="text-xs font-medium text-muted-foreground">{labels.get(p.ref)}</p>
              <p className="font-semibold">{fullName(p)}</p>
              <p className="text-sm text-muted-foreground">
                {[
                  messages.review.dateOfBirth(formatLocalDate(p.dateOfBirth, 'full')),
                  countryName(p.nationality),
                  p.document ? messages.review.passport(p.document.numberMasked) : null,
                  p.associatedAdultRef ? messages.review.infantWith(labels.get(p.associatedAdultRef) ?? '') : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      {booking.contact && (
        <Card id="sum-contact" title={messages.review.contact}>
          <p className="font-semibold">{fullName(booking.contact)}</p>
          <p className="text-sm break-all text-muted-foreground">{booking.contact.email}</p>
          <p className="text-sm text-muted-foreground">{booking.contact.phone}</p>
        </Card>
      )}

      <Card id="sum-extras" title={messages.review.extras}>
        {extras.length === 0 && !insurance ? (
          <p className="text-sm text-muted-foreground">{messages.review.noExtras}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {extras.map((a) => (
              <li key={`${a.serviceId}-${a.passengerRef}`} className="flex justify-between gap-3">
                <span>
                  {a.passengerRef ? `${labels.get(a.passengerRef)} · ` : ''}
                  {a.label}
                  {a.segmentRef && segment.get(a.segmentRef) ? ` · ${segment.get(a.segmentRef)}` : ''}
                </span>
                <span className="tabular-nums">{formatMoney(a.amount)}</span>
              </li>
            ))}
            {insurance && (
              <li className="flex justify-between gap-3">
                <span>
                  {insurance.label}
                  {booking.insurance.policyNumber ? ` · ${messages.complete.policy}: ${booking.insurance.policyNumber}` : ''}
                </span>
                <span className="tabular-nums">{formatMoney(insurance.amount)}</span>
              </li>
            )}
          </ul>
        )}
      </Card>

      {showPrice && (
        <Card id="sum-price" title={messages.review.priceBreakdown}>
          <PriceRows rows={breakdownRows(bookingBreakdown(booking))} />
          <p className="mt-2 text-sm text-muted-foreground">{messages.booking.travellers(booking.offer.passengers.length)}</p>
        </Card>
      )}
    </div>
  );
}
