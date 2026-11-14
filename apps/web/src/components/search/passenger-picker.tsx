'use client';

import { CABIN_CLASSES, type CabinClass } from '@ota/contracts';
import { Minus, Plus, Users } from 'lucide-react';
import { ResponsivePicker } from '@/components/responsive-overlay';
import { Button } from '@/components/ui/button';
import { messages } from '@/lib/messages';
import {
  stepPassengers,
  stepperState,
  type PassengerField,
  type Passengers,
} from '@/lib/passengers';
import { FieldError, FieldTrigger } from './field-trigger';

const ROWS: { field: PassengerField; label: string; hint: string }[] = [
  { field: 'adults', label: messages.pax.adults, hint: messages.pax.adultsHint },
  { field: 'children', label: messages.pax.children, hint: messages.pax.childrenHint },
  { field: 'infants', label: messages.pax.infants, hint: messages.pax.infantsHint },
];

interface Props {
  id: string;
  passengers: Passengers;
  cabin: CabinClass;
  onChange: (value: { passengers: Passengers; cabin: CabinClass }) => void;
  error?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PassengerPicker({ id, passengers, cabin, onChange, error, open, onOpenChange }: Props) {
  const errorId = `${id}-error`;
  const state = stepperState(passengers);
  // One hint per distinct limit currently reached ("+" disabled).
  const hints = [...new Set(ROWS.map((r) => state[r.field].limitHint).filter(Boolean))];
  const summary = `${messages.pax.summary(passengers.adults, passengers.children, passengers.infants)} · ${messages.cabin[cabin]}`;

  return (
    <div className="min-w-0">
      <ResponsivePicker
        open={open}
        onOpenChange={onOpenChange}
        title={messages.search.travellersTitle}
        popoverClassName="w-80"
        trigger={
          <FieldTrigger
            id={id}
            label={messages.search.travellers}
            value={summary}
            placeholder=""
            icon={<Users />}
            hasError={Boolean(error)}
            errorId={errorId}
          />
        }
        footer={
          <Button className="mt-2 w-full" onClick={() => onOpenChange(false)}>
            {messages.search.done}
          </Button>
        }
      >
        <div className="flex flex-col divide-y">
          {ROWS.map(({ field, label, hint }) => {
            const s = state[field];
            return (
              <fieldset key={field} className="flex items-center justify-between gap-4 py-2">
                {/* legend must be the first child; float lets it sit in the flex row. */}
                <legend className="float-left">
                  <span className="block font-medium">{label}</span>
                  <span className="block text-sm text-muted-foreground">{hint}</span>
                </legend>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={messages.pax.remove(label)}
                    disabled={!s.canRemove}
                    onClick={() => onChange({ passengers: stepPassengers(passengers, field, -1), cabin })}
                  >
                    <Minus />
                  </Button>
                  <output aria-live="polite" className="w-6 text-center text-lg font-semibold tabular-nums">
                    {passengers[field]}
                  </output>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={messages.pax.add(label)}
                    disabled={!s.canAdd}
                    onClick={() => onChange({ passengers: stepPassengers(passengers, field, 1), cabin })}
                  >
                    <Plus />
                  </Button>
                </div>
              </fieldset>
            );
          })}
        </div>
        <div aria-live="polite" className="text-sm text-warning-foreground">
          {hints.map((h) => (
            <p key={h} className="mt-2 rounded-md bg-warning px-3 py-2">
              {h}
            </p>
          ))}
        </div>
        <label htmlFor={`${id}-cabin`} className="mt-4 block text-sm font-medium">
          {messages.search.cabin}
        </label>
        {/* Native select: best picker on phones, accessible by default. */}
        <select
          id={`${id}-cabin`}
          value={cabin}
          onChange={(e) => onChange({ passengers, cabin: e.target.value as CabinClass })}
          className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-base"
        >
          {CABIN_CLASSES.map((c) => (
            <option key={c} value={c}>
              {messages.cabin[c]}
            </option>
          ))}
        </select>
      </ResponsivePicker>
      <FieldError id={errorId} message={error} />
    </div>
  );
}
