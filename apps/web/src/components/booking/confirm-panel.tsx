'use client';

import type { PublicBooking } from '@ota/contracts';
import { AlertCircle, Info, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { TermsAgreement } from '@/components/booking/terms-agreement';
import { Button } from '@/components/ui/button';
import { ApiError, bookingApi } from '@/lib/api';
import { completePath, searchUrlForOffer } from '@/lib/booking-steps';
import { messages } from '@/lib/messages';
import { formatMoney } from '@/lib/money-format';

const POLL_MS = 5_000;
const POLL_FOR_MS = 3 * 60_000;

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'slow' } // still CONFIRMING after the polling window
  | { kind: 'failed'; message: string; priceChange: string | null; fareGone: boolean };

const FARE_GONE = 'FARE_NO_LONGER_AVAILABLE';

function failedPhase(failure: PublicBooking['failure']): Phase {
  return failure?.code === FARE_GONE
    ? { kind: 'failed', message: messages.errors.fareGone, priceChange: null, fareGone: true }
    : { kind: 'failed', message: failure?.message ?? messages.review.failedTitle, priceChange: null, fareGone: false };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Step 2 with PAYMENT_PROVIDER=demo (no money; PayPanel is used with a real provider): accept the
 * terms, confirm, wait for the airline. 200 → complete; 202 CONFIRMING →
 * poll GET every 5s (max 3 min). Opening this page while CONFIRMING resumes the polling.
 */
export function ConfirmPanel({ booking }: { booking: PublicBooking }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [agreeError, setAgreeError] = useState(false);
  const inProgress = booking.status === 'PAID' || booking.status === 'CONFIRMING';
  const [phase, setPhase] = useState<Phase>(() =>
    inProgress
      ? { kind: 'confirming' }
      : booking.status === 'FAILED'
        ? failedPhase(booking.failure)
        : { kind: 'idle' },
  );
  const alive = useRef(true);
  const started = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function settle(b: PublicBooking): boolean {
    if (b.status === 'CONFIRMED') {
      router.replace(completePath(b.id));
      return true;
    }
    if (b.status === 'FAILED') {
      setPhase(failedPhase(b.failure));
      return true;
    }
    return false;
  }

  async function poll() {
    const deadline = Date.now() + POLL_FOR_MS;
    while (alive.current && Date.now() < deadline) {
      await wait(POLL_MS);
      if (!alive.current) return;
      try {
        if (settle((await bookingApi.get(booking.id)).data)) return;
      } catch {
        // A failed poll is not an outcome: keep waiting until the deadline.
      }
    }
    if (alive.current) setPhase({ kind: 'slow' });
  }

  // Refresh while PAID/CONFIRMING: pick the polling up again.
  useEffect(() => {
    if (inProgress && !started.current) {
      started.current = true;
      void poll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm() {
    if (!agreed) {
      setAgreeError(true);
      return;
    }
    if (phase.kind === 'confirming') return;
    setPhase({ kind: 'confirming' });
    try {
      const { data } = await bookingApi.confirmDemo(booking.id);
      if (!settle(data)) await poll();
    } catch (err) {
      if (err instanceof ApiError && err.code) {
        if (err.code === 'ILLEGAL_STATE') return router.refresh();
        if (err.code === FARE_GONE) return setPhase(failedPhase({ code: FARE_GONE, message: err.message }));
        const changed = err.body?.previousTotal && err.body.newTotal ? messages.review.failedPriceChanged(formatMoney(err.body.previousTotal), formatMoney(err.body.newTotal)) : null;
        setPhase({ kind: 'failed', message: err.message, priceChange: changed, fareGone: false });
        return;
      }
      // Timeout / network / proxy error: the order may still be in progress — never re-send, just watch.
      await poll();
    }
  }

  if (phase.kind === 'failed') {
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border-2 border-destructive bg-card p-5">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <AlertCircle aria-hidden className="size-5 text-destructive" />
          {messages.review.failedTitle}
        </p>
        {phase.priceChange && <p>{phase.priceChange}</p>}
        <p>{phase.message}</p>
        <p className="text-sm text-muted-foreground">{messages.review.noCharge}</p>
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link href={searchUrlForOffer(booking.offer)}>{phase.fareGone ? messages.trip.searchAgain : messages.review.newSearch}</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <section aria-labelledby="demo-h" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <h2 id="demo-h" className="flex items-center gap-2 text-lg font-semibold">
          <Info aria-hidden className="size-5 text-primary" />
          {messages.review.demoTitle}
        </h2>
        <p className="rounded-lg bg-warning p-3 text-sm text-warning-foreground">{messages.review.demoBody}</p>
        {phase.kind === 'slow' ? (
          <div className="flex flex-col gap-2">
            <output>{messages.review.stillConfirming}</output>
            <Button variant="outline" onClick={() => router.refresh()}>
              {messages.review.refresh}
            </Button>
          </div>
        ) : (
          <>
            <TermsAgreement
              agreed={agreed}
              error={agreeError}
              onChange={(value) => {
                setAgreed(value);
                setAgreeError(false);
              }}
            />
            <Button size="lg" className="w-full" onClick={confirm} disabled={phase.kind === 'confirming'} aria-busy={phase.kind === 'confirming'}>
              {messages.review.confirm}
            </Button>
          </>
        )}
      </section>

      {phase.kind === 'confirming' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 px-6 text-center">
          <Loader2 aria-hidden className="size-12 animate-spin text-primary" />
          <output aria-live="polite">
            <span className="block text-xl font-semibold">{messages.review.confirming}</span>
            <span className="mt-1 block text-muted-foreground">{messages.review.confirmingBody}</span>
          </output>
        </div>
      )}
    </>
  );
}
