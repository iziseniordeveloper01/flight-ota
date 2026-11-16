'use client';

import { Clock } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { messages } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { BlockingDialog } from './blocking-dialog';

const WARNING_SECONDS = 5 * 60;

/** Seconds until an ISO instant (with offset, so Date parsing is correct here); null before mount. */
function useSecondsLeft(expiresAt: string): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const end = new Date(expiresAt).getTime();
    const tick = () => setLeft(Math.max(0, Math.floor((end - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return left;
}

export function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Time left to finish (offer expiry). Amber under 5 minutes; at zero a blocking dialog. */
export function Countdown({ expiresAt, searchUrl }: { expiresAt: string; searchUrl: string }) {
  const left = useSecondsLeft(expiresAt);
  if (left === null) return <div className="h-11" aria-hidden />;
  const warning = left < WARNING_SECONDS;
  return (
    <>
      <p
        className={cn(
          'flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
          warning ? 'bg-warning text-warning-foreground' : 'bg-accent text-accent-foreground',
        )}
      >
        <Clock aria-hidden className="size-4 shrink-0" />
        {/* The visible clock ticks every second; screen readers get it only on demand (no live region spam). */}
        <span>
          <span className="sr-only">{messages.booking.timeLeftLabel}: </span>
          {messages.booking.timeLeft('')}
          <time className="font-bold tabular-nums">{formatCountdown(left)}</time>
        </span>
      </p>
      <ExpiredDialog open={left === 0} searchUrl={searchUrl} />
    </>
  );
}

export function ExpiredDialog({ open, searchUrl }: { open: boolean; searchUrl: string }) {
  return (
    <BlockingDialog
      open={open}
      title={messages.booking.expiredTitle}
      description={messages.booking.expiredBody}
      footer={
        <Button asChild size="lg" className="w-full">
          <Link href={searchUrl}>{messages.trip.searchAgain}</Link>
        </Button>
      }
    />
  );
}
