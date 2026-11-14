'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { ResponsivePicker } from '@/components/responsive-overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { messages } from '@/lib/messages';
import { airportLabel, type AirportValue } from './airport-label';
import { FieldError, FieldTrigger } from './field-trigger';

export type { AirportValue } from './airport-label';

// cmdk + the search UI load on demand (keeps the home page's first-load JS small) and are
// preloaded as soon as the user touches/focuses a field, so opening the picker is still instant.
const loadSearch = () => import('./airport-search');
const AirportSearch = dynamic(loadSearch, {
  ssr: false,
  loading: () => <Skeleton className="h-11 w-full" />,
});

interface Props {
  id: string;
  label: string;
  placeholder: string;
  icon: ReactNode;
  value: AirportValue | null;
  onChange: (value: AirportValue) => void;
  error?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AirportCombobox({
  id,
  label,
  placeholder,
  icon,
  value,
  onChange,
  error,
  open,
  onOpenChange,
}: Props) {
  const errorId = `${id}-error`;
  return (
    <div className="min-w-0">
      <ResponsivePicker
        open={open}
        onOpenChange={onOpenChange}
        title={messages.airport.searchLabel(label)}
        popoverClassName="w-[min(28rem,90vw)] p-1"
        trigger={
          <FieldTrigger
            id={id}
            label={label}
            value={value ? airportLabel(value) : null}
            placeholder={placeholder}
            icon={icon}
            hasError={Boolean(error)}
            errorId={errorId}
            onPointerEnter={() => void loadSearch()}
            onFocus={() => void loadSearch()}
            // Phones: keep text clear of the swap button that floats over the right edge.
            className="pr-16 md:pr-3"
          />
        }
      >
        {/* Mounted only while open, so the query box starts empty every time. */}
        <AirportSearch
          label={label}
          onSelect={(a) => {
            onChange({ iataCode: a.iataCode, city: a.city });
            onOpenChange(false);
          }}
        />
      </ResponsivePicker>
      <FieldError id={errorId} message={error} />
    </div>
  );
}
