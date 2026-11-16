'use client';

import type { PublicBagOption, InsuranceQuote, OfferPassenger, Segment } from '@ota/contracts';
import { Armchair, Check, Luggage, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { bagGroups, type BagSelection } from '@/lib/bag-selection';
import { messages } from '@/lib/messages';
import { formatMoney } from '@/lib/money-format';
import { seatChoosers, type SeatSelection } from '@/lib/seat-selection';
import { cn } from '@/lib/utils';
import { Field, NativeSelect, SectionCard } from './field';

const route = (segments: Segment[], refs: string[]) => {
  const legs = segments.filter((s) => refs.includes(s.ref));
  return legs.length ? `${legs[0].origin} → ${legs[legs.length - 1].destination}` : '';
};

/** Airpaz-style: per passenger per flight group, "No additional baggage" or one option. */
export function BaggageSection({
  bags,
  passengers,
  labels,
  segments,
  value,
  onChange,
  unavailable,
}: {
  bags: PublicBagOption[];
  passengers: OfferPassenger[];
  labels: Map<string, string>;
  segments: Segment[];
  value: BagSelection;
  onChange: (next: BagSelection) => void;
  /** Group keys whose previous choice is no longer sold. */
  unavailable: Set<string>;
}) {
  const groups = bagGroups(bags, passengers.map((p) => p.ref));
  if (!groups.length) return null;
  return (
    <SectionCard id="baggage" title={messages.booking.baggage} description={messages.booking.baggageNote}>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => {
          const id = `bag-${g.key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
          return (
            <Field
              key={g.key}
              id={id}
              label={messages.booking.bagFor(labels.get(g.passengerRef) ?? '', route(segments, g.segmentRefs))}
              error={unavailable.has(g.key) ? messages.booking.unavailableExtra : undefined}
            >
              <div className="relative">
                <Luggage aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <NativeSelect
                  id={id}
                  className="pl-9"
                  aria-invalid={unavailable.has(g.key) || undefined}
                  value={value[g.key] ?? ''}
                  onChange={(e) => {
                    const next = { ...value };
                    if (e.target.value) next[g.key] = e.target.value;
                    else delete next[g.key];
                    onChange(next);
                  }}
                >
                  <option value="">{messages.booking.noBag}</option>
                  {g.options.map((o) => (
                    <option key={o.serviceId} value={o.serviceId}>
                      {messages.booking.bagOption(o.label, formatMoney(o.displayPrice))}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </Field>
          );
        })}
      </div>
    </SectionCard>
  );
}

/** Seat summary per flight + "Select seats" opening the seat map. */
export function SeatSection({
  segments,
  passengers,
  labels,
  selection,
  onOpen,
  unavailableSegments,
}: {
  segments: Segment[];
  passengers: OfferPassenger[];
  labels: Map<string, string>;
  selection: SeatSelection;
  onOpen: (segmentRef: string) => void;
  unavailableSegments: Set<string>;
}) {
  const choosers = seatChoosers(passengers);
  return (
    <SectionCard id="seats" title={messages.booking.seats} description={messages.booking.seatsNote}>
      <ul className="flex flex-col gap-3">
        {segments.map((s) => {
          const picked = selection[s.ref] ?? {};
          const any = Object.keys(picked).length > 0;
          return (
            <li
              key={s.ref}
              className={cn('flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3', unavailableSegments.has(s.ref) && 'border-2 border-destructive')}
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  <Armchair aria-hidden className="size-4 text-muted-foreground" />
                  {s.origin} → {s.destination}
                  <span className="text-sm font-normal text-muted-foreground">
                    {s.marketingCarrier.code} {s.flightNumber}
                  </span>
                </p>
                <ul className="mt-1 text-sm text-muted-foreground">
                  {choosers.map((p) => (
                    <li key={p.ref}>
                      {labels.get(p.ref)}: {picked[p.ref] ? `${picked[p.ref].label} · ${formatMoney(picked[p.ref].price)}` : messages.booking.noSeat}
                    </li>
                  ))}
                </ul>
                {unavailableSegments.has(s.ref) && <p className="mt-1 text-sm font-medium text-destructive">{messages.booking.unavailableExtra}</p>}
              </div>
              <Button type="button" variant="outline" onClick={() => onOpen(s.ref)}>
                {any ? messages.booking.changeSeats : messages.booking.selectSeats}
              </Button>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

export function InsuranceCard({
  quote,
  checked,
  onChange,
  error,
}: {
  quote: InsuranceQuote;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error: boolean;
}) {
  return (
    <SectionCard
      id="insurance"
      title={messages.booking.insurance}
      action={quote.demo ? <Badge variant="secondary">{messages.booking.demo}</Badge> : undefined}
    >
      <div className={cn('rounded-lg border p-4', checked && 'border-primary bg-accent', error && 'border-2 border-destructive')}>
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck aria-hidden className="size-5 text-primary" />
          {quote.name}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{quote.description}</p>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {messages.booking.insuranceBenefits.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
              {b}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm font-medium">{messages.booking.insurancePerPassenger(formatMoney(quote.pricePerPassenger))}</p>
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 font-medium">
          <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} aria-invalid={error || undefined} />
          {messages.booking.insuranceAdd(formatMoney(quote.total))}
        </label>
        {error && <p className="text-sm font-medium text-destructive">{messages.booking.insuranceUnavailable}</p>}
      </div>
    </SectionCard>
  );
}
