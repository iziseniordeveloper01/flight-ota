'use client';

import { ChevronDown } from 'lucide-react';
import { useMemo, useState, type Ref } from 'react';
import { ResponsivePicker } from '@/components/responsive-overlay';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { countries, countryName } from '@/lib/countries';
import { messages } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { errorId } from './field';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (code: string) => void;
  onBlur?: () => void;
  invalid?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/** Searchable country picker (cmdk): full-screen sheet on phones, popover from md. Value = ISO alpha-2. */
export function CountrySelect({ id, label, value, onChange, onBlur, invalid, ref }: Props) {
  const [open, setOpen] = useState(false);
  const list = useMemo(() => (open ? countries() : []), [open]);
  return (
    <ResponsivePicker
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onBlur?.();
      }}
      title={`${messages.booking.countrySearch}: ${label}`}
      popoverClassName="w-[min(24rem,90vw)] p-1"
      trigger={
        <button
          id={id}
          ref={ref}
          type="button"
          aria-haspopup="dialog"
          aria-label={`${label}: ${value ? countryName(value) : messages.booking.chooseCountry}`}
          aria-describedby={invalid ? errorId(id) : undefined}
          data-invalid={invalid || undefined}
          className={cn(
            'flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-base transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-invalid:border-destructive data-invalid:ring-3 data-invalid:ring-destructive/20 md:text-sm',
            !value && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{value ? countryName(value) : messages.booking.chooseCountry}</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      }
    >
      <Command label={`${messages.booking.countrySearch}: ${label}`}>
        <CommandInput autoFocus placeholder={messages.booking.countrySearch} aria-label={messages.booking.countrySearch} autoComplete="off" />
        <CommandList className="max-h-[70dvh] md:max-h-72">
          <CommandEmpty>{messages.booking.countryNoResults}</CommandEmpty>
          {list.map((c) => (
            <CommandItem
              key={c.code}
              value={`${c.name} ${c.code}`}
              onSelect={() => {
                onChange(c.code);
                setOpen(false);
                onBlur?.();
              }}
              data-checked={c.code === value || undefined}
            >
              {c.name}
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </ResponsivePicker>
  );
}
