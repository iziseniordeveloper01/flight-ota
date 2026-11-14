'use client';

import { searchDateBounds } from '@ota/contracts';
import { CalendarDays } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { DateRange } from 'react-day-picker';
import { ResponsivePicker } from '@/components/responsive-overlay';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsDesktop } from '@/hooks/use-media-query';
import { formatLocalDate, isoToPickerDate, pickerDateToIso } from '@/lib/local-time';
import { messages } from '@/lib/messages';
import { FieldError, FieldTrigger } from './field-trigger';

// react-day-picker (+ date-fns) is the biggest widget dependency and only needed once the picker
// opens: load it on demand, preloading when the field is touched or focused.
const loadCalendar = () => import('@/components/ui/calendar');
const Calendar = dynamic(() => loadCalendar().then((m) => m.Calendar), {
  ssr: false,
  loading: () => <Skeleton className="mx-auto h-80 w-80 max-w-full" />,
});

interface Props {
  id: string;
  roundTrip: boolean;
  depart: string | null;
  ret: string | null;
  onChange: (dates: { depart: string | null; ret: string | null }) => void;
  departError?: string;
  returnError?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DateField({
  id,
  roundTrip,
  depart,
  ret,
  onChange,
  departError,
  returnError,
  open,
  onOpenChange,
}: Props) {
  const isDesktop = useIsDesktop();
  const errorId = `${id}-error`;
  const error = departError ?? returnError;

  const label = roundTrip ? `${messages.search.depart} – ${messages.search.return}` : messages.search.depart;
  const value = depart
    ? roundTrip
      ? `${formatLocalDate(depart, 'weekday')} – ${ret ? formatLocalDate(ret, 'weekday') : messages.search.returnPlaceholder}`
      : formatLocalDate(depart, 'weekday')
    : null;

  // Same bounds as the shared schema, so every enabled day is one the API accepts.
  const { first, last } = searchDateBounds();
  const firstDate = isoToPickerDate(first);
  const lastDate = isoToPickerDate(last);
  const common = {
    disabled: [{ before: firstDate }, { after: lastDate }],
    startMonth: firstDate,
    endMonth: lastDate,
    defaultMonth: depart ? isoToPickerDate(depart) : firstDate,
    numberOfMonths: isDesktop && roundTrip ? 2 : 1,
    className: 'mx-auto p-0',
  };

  return (
    <div className="min-w-0">
      <ResponsivePicker
        open={open}
        onOpenChange={onOpenChange}
        title={messages.search.datesTitle}
        trigger={
          <FieldTrigger
            id={id}
            label={label}
            value={value}
            placeholder={messages.search.datePlaceholder}
            icon={<CalendarDays />}
            hasError={Boolean(error)}
            errorId={errorId}
            onPointerEnter={() => void loadCalendar()}
            onFocus={() => void loadCalendar()}
          />
        }
        footer={
          roundTrip ? (
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              {messages.search.done}
            </Button>
          ) : undefined
        }
      >
        {roundTrip ? (
          <Calendar
            {...common}
            mode="range"
            selected={{
              from: depart ? isoToPickerDate(depart) : undefined,
              to: ret ? isoToPickerDate(ret) : undefined,
            }}
            onSelect={(range: DateRange | undefined) =>
              onChange({
                depart: range?.from ? pickerDateToIso(range.from) : null,
                ret: range?.to ? pickerDateToIso(range.to) : null,
              })
            }
          />
        ) : (
          <Calendar
            {...common}
            mode="single"
            selected={depart ? isoToPickerDate(depart) : undefined}
            onSelect={(date: Date | undefined) => {
              onChange({ depart: date ? pickerDateToIso(date) : null, ret: null });
              if (date) onOpenChange(false); // one tap is the whole job for one-way
            }}
          />
        )}
      </ResponsivePicker>
      <FieldError id={errorId} message={error} />
    </div>
  );
}
