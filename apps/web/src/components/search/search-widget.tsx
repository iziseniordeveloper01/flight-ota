'use client';

import type { CabinClass } from '@ota/contracts';
import { ArrowUpDown, PlaneLanding, PlaneTakeoff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { messages } from '@/lib/messages';
import type { Passengers } from '@/lib/passengers';
import { saveRecentSearch } from '@/lib/recent-searches';
import { cn } from '@/lib/utils';
import {
  searchUrl,
  validateSearch,
  type SearchErrors,
  type SearchState,
} from '@/lib/search-params';
import { AirportCombobox, type AirportValue } from './airport-combobox';
import { DateField } from './date-field';
import { PassengerPicker } from './passenger-picker';

type Picker = 'from' | 'to' | 'dates' | 'pax' | null;

export interface SearchWidgetInitial extends Partial<SearchState> {
  fromCity?: string | null;
  toCity?: string | null;
}

interface Props {
  initial?: SearchWidgetInitial;
  /** Called after navigation starts (e.g. to close the "Edit search" sheet). */
  onSubmitted?: () => void;
  /** "stacked" keeps the md layout at lg too (used inside the edit dialog, which is narrow). */
  layout?: 'auto' | 'stacked';
  className?: string;
}

function airport(code: string | null | undefined, city?: string | null): AirportValue | null {
  return code ? { iataCode: code, city: city ?? null } : null;
}

export function SearchWidget({ initial, onSubmitted, layout = 'auto', className }: Props) {
  const router = useRouter();
  const id = useId();
  const [roundTrip, setRoundTrip] = useState(Boolean(initial?.return));
  const [from, setFrom] = useState(() => airport(initial?.from, initial?.fromCity));
  const [to, setTo] = useState(() => airport(initial?.to, initial?.toCity));
  const [depart, setDepart] = useState<string | null>(initial?.depart ?? null);
  const [ret, setRet] = useState<string | null>(initial?.return ?? null);
  const [passengers, setPassengers] = useState<Passengers>({
    adults: initial?.adults ?? 1,
    children: initial?.children ?? 0,
    infants: initial?.infants ?? 0,
  });
  const [cabin, setCabin] = useState<CabinClass>(initial?.cabin ?? 'economy');
  const [errors, setErrors] = useState<SearchErrors>({});
  const [openPicker, setOpenPicker] = useState<Picker>(null);

  const pickerProps = (name: Exclude<Picker, null>) => ({
    open: openPicker === name,
    onOpenChange: (open: boolean) => setOpenPicker(open ? name : null),
  });

  // Clear a field's error as soon as the user changes that field.
  const clearError = (...fields: (keyof SearchErrors)[]) =>
    setErrors((e) => {
      const next = { ...e };
      for (const f of fields) delete next[f];
      return next;
    });

  function swap() {
    setFrom(to);
    setTo(from);
    clearError('from', 'to');
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const state: SearchState = {
      from: from?.iataCode ?? null,
      to: to?.iataCode ?? null,
      depart,
      return: roundTrip ? ret : null,
      ...passengers,
      cabin,
    };

    // The shared schema is the source of truth; friendlier copy for the common "missing" cases.
    const result = validateSearch(state);
    const next: SearchErrors = result.ok ? {} : { ...result.errors };
    if (!from) next.from = messages.search.airportRequired;
    if (!to) next.to = messages.search.airportRequired;
    else if (from && from.iataCode === to.iataCode) next.to = messages.search.sameAirport;
    if (!depart) next.depart = messages.search.dateRequired;
    if (roundTrip && !ret) next.return = messages.search.returnRequired;

    if (Object.keys(next).length > 0 || !result.ok) {
      setErrors(next);
      return;
    }

    const body = result.body;
    saveRecentSearch({
      from: body.origin,
      to: body.destination,
      fromCity: from?.city ?? null,
      toCity: to?.city ?? null,
      depart: body.departureDate,
      return: body.returnDate ?? null,
      adults: body.adults,
      children: body.children,
      infants: body.infants,
      cabin: body.cabin,
    });
    router.push(searchUrl(state));
    onSubmitted?.();
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={messages.search.title}
      className={cn('flex flex-col gap-3', className)}
    >
      <fieldset className="flex w-fit gap-1 rounded-lg bg-muted p-1">
        <legend className="sr-only">{messages.search.tripType}</legend>
        {[
          { value: false, label: messages.search.oneWay },
          { value: true, label: messages.search.roundTrip },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            aria-pressed={roundTrip === opt.value}
            onClick={() => {
              setRoundTrip(opt.value);
              if (!opt.value) setRet(null);
              clearError('return');
            }}
            className="min-h-11 rounded-md px-4 text-sm font-medium text-muted-foreground transition-colors aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm"
          >
            {opt.label}
          </button>
        ))}
      </fieldset>

      <div
        className={cn(
          'grid gap-3',
          layout === 'auto' &&
            'lg:grid-cols-[minmax(0,2.6fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_auto] lg:items-start',
        )}
      >
        {/* From / To with a swap button: stacked on phones, side by side from md. */}
        {/* md gap-x-14 leaves room for the 44px swap button between the two fields. */}
        <div className="relative grid gap-2 md:grid-cols-2 md:gap-x-14">
          <AirportCombobox
            id={`${id}-from`}
            label={messages.search.from}
            placeholder={messages.search.fromPlaceholder}
            icon={<PlaneTakeoff />}
            value={from}
            onChange={(v) => {
              setFrom(v);
              clearError('from', 'to');
            }}
            error={errors.from}
            {...pickerProps('from')}
          />
          <AirportCombobox
            id={`${id}-to`}
            label={messages.search.to}
            placeholder={messages.search.toPlaceholder}
            icon={<PlaneLanding />}
            value={to}
            onChange={(v) => {
              setTo(v);
              clearError('to');
            }}
            error={errors.to}
            {...pickerProps('to')}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={swap}
            aria-label={messages.search.swap}
            className="absolute top-9.5 right-3 rounded-full bg-card shadow-sm md:top-1.5 md:right-auto md:left-1/2 md:-translate-x-1/2"
          >
            <ArrowUpDown className="md:rotate-90" />
          </Button>
        </div>

        <DateField
          id={`${id}-dates`}
          roundTrip={roundTrip}
          depart={depart}
          ret={ret}
          onChange={(d) => {
            setDepart(d.depart);
            setRet(d.ret);
            clearError('depart', 'return');
          }}
          departError={errors.depart}
          returnError={errors.return}
          {...pickerProps('dates')}
        />

        <PassengerPicker
          id={`${id}-pax`}
          passengers={passengers}
          cabin={cabin}
          onChange={(v) => {
            setPassengers(v.passengers);
            setCabin(v.cabin);
            clearError('pax', 'cabin');
          }}
          error={errors.pax ?? errors.cabin}
          {...pickerProps('pax')}
        />

        <Button
          type="submit"
          size="lg"
          className={cn('h-14 w-full text-base', layout === 'auto' && 'lg:w-auto')}
        >
          {messages.search.submit}
        </Button>
      </div>
    </form>
  );
}
