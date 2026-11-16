'use client';

import { ChevronUp, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PriceBreakdown } from '@/lib/booking-price';
import { messages } from '@/lib/messages';
import { formatMoney } from '@/lib/money-format';
import { cn } from '@/lib/utils';
import { breakdownRows, PriceRows } from './price-rows';

interface Props {
  price: PriceBreakdown;
  travellers: number;
  submitting: boolean;
  /** Submit button of the step-1 form (type=submit, form=…). */
  formId: string;
}

/** Desktop: sticky right column. */
export function PriceAside({ price, travellers, submitting, formId }: Props) {
  return (
    <aside aria-labelledby="price-detail-h" className="hidden rounded-xl border bg-card p-5 lg:sticky lg:top-4 lg:block">
      <h2 id="price-detail-h" className="mb-3 text-lg font-semibold">
        {messages.booking.priceDetail}
      </h2>
      <PriceRows rows={breakdownRows(price)} />
      <p className="mt-2 text-sm text-muted-foreground">{messages.booking.travellers(travellers)}</p>
      <ContinueButton submitting={submitting} formId={formId} className="mt-4 w-full" />
    </aside>
  );
}

/** Phones: total + Details (expands the breakdown) + Continue, always in reach. */
export function PriceBar({ price, travellers, submitting, formId }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card shadow-[0_-4px_16px_rgb(0_0_0/0.06)] lg:hidden">
      {open && (
        <div id="price-breakdown" className="max-h-[50dvh] overflow-y-auto border-b px-4 py-3">
          <PriceRows rows={breakdownRows(price)} />
          <p className="mt-2 text-sm text-muted-foreground">{messages.booking.travellers(travellers)}</p>
        </div>
      )}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold tabular-nums">{formatMoney(price.total)}</p>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="price-breakdown"
            onClick={() => setOpen((o) => !o)}
            className="-my-2 flex min-h-11 items-center gap-1 text-sm font-medium text-primary"
          >
            {open ? messages.booking.hideDetails : messages.booking.details}
            <ChevronUp aria-hidden className={cn('size-4 transition-transform', !open && 'rotate-180')} />
          </button>
        </div>
        <ContinueButton submitting={submitting} formId={formId} className="w-40" />
      </div>
    </div>
  );
}

function ContinueButton({ submitting, formId, className }: { submitting: boolean; formId: string; className?: string }) {
  return (
    <Button type="submit" form={formId} size="lg" disabled={submitting} aria-busy={submitting} className={className}>
      {submitting && <Loader2 aria-hidden className="animate-spin" />}
      {submitting ? messages.booking.saving : messages.booking.continue}
    </Button>
  );
}
