'use client';

import type { AirportSuggestion } from '@ota/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Command, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api } from '@/lib/api';
import { LOCALE, messages } from '@/lib/messages';
import { airportLabel } from './airport-label';

// Loaded lazily (next/dynamic) by AirportCombobox: cmdk is only needed once a picker opens.

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

let regionNames: Intl.DisplayNames | undefined;
function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames([LOCALE], { type: 'region' });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export default function AirportSearch({
  label,
  onSelect,
}: {
  label: string;
  onSelect: (a: AirportSuggestion) => void;
}) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, DEBOUNCE_MS);
  const enabled = debounced.length >= MIN_CHARS;

  const { data, isFetching, isError } = useQuery({
    queryKey: ['airports', debounced.toLowerCase()],
    queryFn: ({ signal }) => api.searchAirports(debounced, signal),
    enabled,
    staleTime: 60 * 60_000, // airport data is static; the API also caches it for an hour
    placeholderData: keepPreviousData, // keep the old list while the next keystroke loads
  });

  const waiting = trimmed !== debounced || (isFetching && !data);
  const results = trimmed.length >= MIN_CHARS ? (data ?? []) : [];

  let status: string | null = null;
  if (trimmed.length < MIN_CHARS) status = messages.airport.minChars;
  else if (isError && !waiting) status = messages.airport.error;
  else if (waiting && results.length === 0) status = messages.airport.loading;
  else if (!waiting && results.length === 0) status = messages.airport.noResults;

  return (
    // shouldFilter=false: the API already ranks matches; cmdk only handles keyboard nav + ARIA.
    <Command shouldFilter={false} label={messages.airport.searchLabel(label)}>
      <CommandInput
        autoFocus
        value={query}
        onValueChange={setQuery}
        placeholder={messages.airport.inputPlaceholder}
        aria-label={messages.airport.searchLabel(label)}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {/* Outside the listbox (only options may live in it); <output> = polite live region. */}
      <output
        className={status ? 'block px-3 py-6 text-center text-sm text-muted-foreground' : 'sr-only'}
      >
        {status ?? (waiting ? messages.airport.loading : '')}
      </output>
      <CommandList className="max-h-[60dvh] md:max-h-80">
        {results.map((a) => (
          <CommandItem
            key={a.iataCode}
            value={a.iataCode}
            onSelect={() => onSelect(a)}
            className="items-start py-2"
          >
            <span className="min-w-0 text-sm">
              <span className="font-semibold">{airportLabel(a)}</span>{' '}
              <span className="text-muted-foreground">
                — {a.name}, {countryName(a.countryCode)}
              </span>
            </span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}
