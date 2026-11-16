'use client';

import { AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { startTransition } from 'react';
import { Button } from '@/components/ui/button';
import { messages } from '@/lib/messages';

/** API / supplier unavailable while rendering a booking step. */
export default function BookingError({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-10 text-center">
        <AlertCircle aria-hidden className="size-8 text-destructive" />
        <h1 className="text-xl font-semibold">{messages.booking.loadFailed}</h1>
        <Button
          className="mt-2"
          onClick={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
        >
          {messages.booking.retry}
        </Button>
      </div>
    </div>
  );
}
