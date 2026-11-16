'use client';

import { useState, type Ref } from 'react';
import { daysInMonth, isoDateToParts, partsToIsoDate, type DateParts } from '@/lib/date-parts';
import { LOCALE, messages } from '@/lib/messages';
import { errorId, FieldError, NativeSelect } from './field';

const monthName = (m: number) =>
  new Intl.DateTimeFormat(LOCALE, { month: 'long', timeZone: 'UTC' }).format(Date.UTC(2000, m - 1, 1));
const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) }));

interface Props {
  id: string;
  label: string;
  /** ISO YYYY-MM-DD, or "" until complete. */
  value: string;
  onChange: (iso: string) => void;
  onBlur?: () => void;
  years: number[];
  error?: string;
  ref?: Ref<HTMLSelectElement>;
}

/** Day / month / year selects writing an ISO date (or "" while incomplete) — no calendar paging. */
export function DateSelects({ id, label, value, onChange, onBlur, years, error, ref }: Props) {
  const [parts, setParts] = useState<DateParts>(() => isoDateToParts(value));
  const [seenValue, setSeenValue] = useState(value);

  // A reset / server value from outside: show it (unless it is what the selects already say).
  // Adjusting state during render (not in an effect) avoids an extra render pass.
  if (value !== seenValue) {
    setSeenValue(value);
    if (value && value !== partsToIsoDate(parts)) setParts(isoDateToParts(value));
  }

  const update = (key: keyof DateParts, v: string) => {
    const next = { ...parts, [key]: v };
    setParts(next);
    onChange(partsToIsoDate(next));
  };

  const maxDay = parts.month && parts.year ? daysInMonth(Number(parts.year), Number(parts.month)) : 31;
  const invalid = Boolean(error);
  const common = {
    'aria-invalid': invalid || undefined,
    'aria-describedby': invalid ? errorId(id) : undefined,
    onBlur,
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-[1fr_1.6fr_1.3fr] gap-2">
        <NativeSelect id={id} ref={ref} aria-label={`${label}: ${messages.booking.day}`} value={parts.day} onChange={(e) => update('day', e.target.value)} {...common}>
          <option value="">{messages.booking.day}</option>
          {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((d) => (
            <option key={d} value={d} disabled={Number(d) > maxDay}>
              {d}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={`${label}: ${messages.booking.month}`} value={parts.month} onChange={(e) => update('month', e.target.value)} {...common}>
          <option value="">{messages.booking.month}</option>
          {MONTHS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={`${label}: ${messages.booking.year}`} value={parts.year} onChange={(e) => update('year', e.target.value)} {...common}>
          <option value="">{messages.booking.year}</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </NativeSelect>
      </div>
      <FieldError id={errorId(id)}>{error}</FieldError>
    </fieldset>
  );
}
