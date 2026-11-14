'use client';

import type { PublicFlightOffer } from '@ota/contracts';
import { SlidersHorizontal } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { AirlineLogo } from '@/components/offer/airline-logo';
import { ResponsiveDialog } from '@/components/responsive-overlay';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { messages } from '@/lib/messages';
import { formatMinor, formatMoney } from '@/lib/money-format';
import {
  EMPTY_FILTERS,
  STOP_BUCKETS,
  TIME_BUCKETS,
  activeFilterCount,
  applyFilters,
  type FilterFacets,
  type OfferFilters,
} from '@/lib/offer-filters';

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    // min-w-0: a fieldset is min-content wide by default, which stops long labels from truncating.
    <fieldset className="flex min-w-0 flex-col">
      <legend className="mb-1 font-semibold">{title}</legend>
      {note && <p className="mb-1 text-xs text-muted-foreground">{note}</p>}
      {children}
    </fieldset>
  );
}

function CheckRow({
  id,
  label,
  icon,
  aside,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  icon?: ReactNode;
  aside?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    // The whole row is the label, so the tap target is the full 44px-high row, not the 16px box.
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-50">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      {icon}
      {/* title: the full name on hover when a long label is truncated. */}
      <span className="min-w-0 flex-1 truncate" title={label}>
        {label}
      </span>
      {aside && <span className="text-muted-foreground tabular-nums">{aside}</span>}
    </label>
  );
}

interface PanelProps {
  idPrefix: string;
  value: OfferFilters;
  onChange: (next: OfferFilters) => void;
  facets: FilterFacets;
}

export function FiltersPanel({ idPrefix, value, onChange, facets }: PanelProps) {
  const set = (patch: Partial<OfferFilters>) => onChange({ ...value, ...patch });
  const price = facets.price;
  // Drag updates local state; the URL (and filtering) updates when the thumb is released.
  const [drag, setDrag] = useState<number[] | null>(null);
  const range = price
    ? (drag ?? [
        Number(value.priceMin ?? price.min),
        Number(value.priceMax ?? price.max),
      ])
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Group title={messages.filters.stops}>
        {STOP_BUCKETS.map((b) => (
          <CheckRow
            key={b}
            id={`${idPrefix}-stops-${b}`}
            label={messages.filters.stopsLabel[b]}
            aside={String(facets.stops[b])}
            checked={value.stops.includes(b)}
            disabled={facets.stops[b] === 0 && !value.stops.includes(b)}
            onChange={() => set({ stops: toggle(value.stops, b) })}
          />
        ))}
      </Group>
      <Separator />
      <Group title={messages.filters.airlines}>
        {facets.airlines.map((a) => (
          <CheckRow
            key={a.code}
            id={`${idPrefix}-airline-${a.code}`}
            label={a.name}
            icon={<AirlineLogo carrier={a} />}
            aside={a.minPrice ? messages.filters.from(formatMoney(a.minPrice)) : String(a.count)}
            checked={value.airlines.includes(a.code)}
            onChange={() => set({ airlines: toggle(value.airlines, a.code) })}
          />
        ))}
      </Group>
      <Separator />
      <Group title={messages.filters.departure} note={messages.filters.departureNote}>
        {TIME_BUCKETS.map((t) => (
          <CheckRow
            key={t}
            id={`${idPrefix}-time-${t}`}
            label={messages.filters.timeBucket[t]}
            aside={String(facets.times[t])}
            checked={value.times.includes(t)}
            disabled={facets.times[t] === 0 && !value.times.includes(t)}
            onChange={() => set({ times: toggle(value.times, t) })}
          />
        ))}
      </Group>
      {price && range && price.min < price.max && (
        <>
          <Separator />
          <Group title={messages.filters.price}>
            <p className="mb-3 text-sm tabular-nums" aria-live="polite">
              {messages.filters.priceRange(
                formatMinor(BigInt(range[0]), price.currency),
                formatMinor(BigInt(range[1]), price.currency),
              )}
            </p>
            <Slider
              className="py-2.5"
              min={Number(price.min)}
              max={Number(price.max)}
              // ~100 steps across the range; minor units are integers, so the bounds stay exact.
              step={Math.max(1, Math.round(Number(price.max - price.min) / 100))}
              minStepsBetweenThumbs={0}
              value={range}
              thumbLabels={[messages.filters.priceMin, messages.filters.priceMax]}
              onValueChange={setDrag}
              onValueCommit={([lo, hi]) => {
                setDrag(null);
                set({
                  // At the extremes the bound is "off", so new cheaper/dearer fares are not hidden.
                  priceMin: lo <= Number(price.min) ? null : BigInt(lo),
                  priceMax: hi >= Number(price.max) ? null : BigInt(hi),
                });
              }}
            />
          </Group>
        </>
      )}
      <Separator />
      <CheckRow
        id={`${idPrefix}-refundable`}
        label={messages.filters.refundable}
        checked={value.refundableOnly}
        onChange={() => set({ refundableOnly: !value.refundableOnly })}
      />
    </div>
  );
}

interface MobileProps {
  value: OfferFilters;
  onApply: (next: OfferFilters) => void;
  facets: FilterFacets;
  offers: PublicFlightOffer[];
}

/** Below lg: "Filters (n)" opens a sheet with a draft copy; nothing changes until Apply. */
export function MobileFilters({ value, onApply, facets, offers }: MobileProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const count = activeFilterCount(value);
  const draftCount = applyFilters(offers, draft).length;

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
      >
        <SlidersHorizontal aria-hidden />
        {messages.filters.button(count)}
      </Button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title={messages.filters.title}
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDraft(EMPTY_FILTERS)}>
              {messages.filters.reset}
            </Button>
            <Button
              className="flex-[2]"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              {messages.filters.applyCount(draftCount)}
            </Button>
          </div>
        }
      >
        <FiltersPanel idPrefix="m" value={draft} onChange={setDraft} facets={facets} />
      </ResponsiveDialog>
    </>
  );
}
