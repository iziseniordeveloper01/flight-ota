'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError, bookingApi } from '@/lib/api';
import { bookingPath } from '@/lib/booking-steps';
import { messages } from '@/lib/messages';
import { cn } from '@/lib/utils';

/**
 * "Checkout" on the trip summary: creates the booking through our BFF (which keeps the guest token
 * in an httpOnly cookie) and opens step 1. A price change at creation is shown there (?was=).
 */
export function CheckoutButton({ offerId, className }: { offerId: string; className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    setPending(true);
    setError(null);
    try {
      const { data, meta } = await bookingApi.create(offerId);
      const was = meta.priceChanged && meta.previousTotal ? `?${new URLSearchParams({ was: meta.previousTotal.amount })}` : '';
      router.push(`${bookingPath(data.id)}${was}`);
      // Keep the spinner until the next page replaces this one.
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError && err.kind === 'expired') {
        router.refresh(); // the server page re-checks the offer and shows the expired state
        return;
      }
      setError(err instanceof ApiError && err.kind !== 'validation' ? err.message : messages.trip.createFailed);
    }
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Button size="lg" className="w-full" onClick={checkout} disabled={pending} aria-busy={pending}>
        {pending && <Loader2 aria-hidden className="animate-spin" />}
        {pending ? messages.trip.checkingOut : messages.trip.checkout}
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
