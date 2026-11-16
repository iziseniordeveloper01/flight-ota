'use client';

import type { PaymentVerifyBody, PublicBooking } from '@ota/contracts';
import { AlertCircle, CreditCard, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { TermsAgreement } from '@/components/booking/terms-agreement';
import { Button } from '@/components/ui/button';
import { ApiError, bookingApi } from '@/lib/api';
import { completePath, searchUrlForOffer } from '@/lib/booking-steps';
import { messages } from '@/lib/messages';
import { formatMoney } from '@/lib/money-format';
import { openCheckout } from '@/lib/razorpay-checkout';

const POLL_MS = 3_000;
const POLL_FOR_MS = 4 * 60_000;
const FARE_GONE_CODES = new Set(['FARE_NO_LONGER_AVAILABLE', 'PAYMENT_WINDOW_CLOSED', 'BOOKING_EXPIRED']);
const REFUND_STATUSES = new Set(['FAILED', 'REFUND_PENDING', 'REFUNDED']);

type Phase =
  | { kind: 'idle' }
  | { kind: 'opening' } // creating the order / loading checkout
  | { kind: 'paying' } // checkout open
  | { kind: 'confirming' } // money in, waiting for the ticket
  | { kind: 'slow' } // still confirming after the polling window
  | { kind: 'error'; message: string; fareGone: boolean }
  | { kind: 'refund'; booking: PublicBooking };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function initialPhase(booking: PublicBooking): Phase {
  if (booking.status === 'PAID' || booking.status === 'CONFIRMING') return { kind: 'confirming' };
  if (REFUND_STATUSES.has(booking.status)) return { kind: 'refund', booking };
  return { kind: 'idle' };
}

/**
 * Step 2 with a real payment provider: "Pay ₹X" → Razorpay Checkout → our server verifies the
 * signature and the payment → the ticketing job books the flight while we poll (3s, max 4 min).
 * A failed or cancelled payment offers "Try again" (a new order). Opening the page while
 * PAID/CONFIRMING resumes polling; FAILED/REFUND_PENDING/REFUNDED shows the refund message.
 */
export function PayPanel({ booking }: { booking: PublicBooking }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [agreeError, setAgreeError] = useState(false);
  const [phase, setPhase] = useState<Phase>(() => initialPhase(booking));
  const alive = useRef(true);
  const polling = useRef(false);
  const total = formatMoney(booking.displayPrice.total);

  useEffect(() => {
    alive.current = true;
    if (phase.kind === 'confirming') void poll();
    return () => {
      alive.current = false;
    };
    // Resume polling once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function settle(b: PublicBooking): boolean {
    if (b.status === 'CONFIRMED') {
      router.replace(completePath(b.id));
      return true;
    }
    if (REFUND_STATUSES.has(b.status)) {
      setPhase({ kind: 'refund', booking: b });
      return true;
    }
    if (b.status === 'EXPIRED') {
      router.refresh();
      return true;
    }
    return false;
  }

  async function poll() {
    if (polling.current) return;
    polling.current = true;
    const deadline = Date.now() + POLL_FOR_MS;
    try {
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
    } finally {
      polling.current = false;
    }
  }

  async function verify(response: PaymentVerifyBody) {
    setPhase({ kind: 'confirming' });
    try {
      await bookingApi.paymentVerify(booking.id, response);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'PAYMENT_NOT_CAPTURED' || err.code === 'PAYMENT_VERIFICATION_FAILED')) {
        setPhase({ kind: 'error', message: err.message, fareGone: false });
        return;
      }
      // Timeout / network / 5xx: the money may well be in (webhook + reconciliation settle it). Watch.
    }
    await poll();
  }

  async function pay() {
    if (!agreed) {
      setAgreeError(true);
      return;
    }
    if (phase.kind === 'opening' || phase.kind === 'paying') return;
    setPhase({ kind: 'opening' });
    let order;
    try {
      order = (await bookingApi.paymentOrder(booking.id)).data;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ILLEGAL_STATE') return router.refresh();
      const fareGone = err instanceof ApiError && FARE_GONE_CODES.has(err.code ?? '');
      setPhase({ kind: 'error', message: fareGone ? messages.errors.fareGone : err instanceof Error ? err.message : messages.errors.server, fareGone });
      return;
    }
    try {
      await openCheckout(order, {
        onSuccess: (response) => void verify(response),
        onFailure: () => setPhase({ kind: 'error', message: messages.review.paymentFailed, fareGone: false }),
        onDismiss: () => setPhase({ kind: 'error', message: messages.review.paymentCancelled, fareGone: false }),
      });
      setPhase((p) => (p.kind === 'opening' ? { kind: 'paying' } : p));
    } catch {
      setPhase({ kind: 'error', message: messages.review.checkoutUnavailable, fareGone: false });
    }
  }

  if (phase.kind === 'refund') {
    const b = phase.booking;
    const amount = formatMoney(b.payment.refund?.amount ?? b.displayPrice.total);
    const body =
      b.payment.refund?.status === 'failed'
        ? messages.review.refundProblem
        : b.status === 'REFUNDED' || b.payment.refund?.status === 'processed'
          ? messages.review.refundedBody(amount)
          : messages.review.refundBody(amount);
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border-2 border-destructive bg-card p-5" data-testid="refund-panel">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <AlertCircle aria-hidden className="size-5 text-destructive" />
          {messages.review.refundTitle}
        </p>
        <p>{body}</p>
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link href={searchUrlForOffer(b.offer)}>{messages.review.newSearch}</Link>
        </Button>
      </div>
    );
  }

  const busy = phase.kind === 'opening' || phase.kind === 'paying';
  return (
    <>
      <section aria-labelledby="pay-h" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <h2 id="pay-h" className="flex items-center gap-2 text-lg font-semibold">
          <CreditCard aria-hidden className="size-5 text-primary" />
          {messages.review.payTitle}
        </h2>
        <p className="text-sm text-muted-foreground">{messages.review.payBody}</p>
        {booking.demo && <p className="rounded-lg bg-warning p-3 text-sm text-warning-foreground">{messages.review.payTestMode}</p>}
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
            {phase.kind === 'error' && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive p-3 text-sm">
                <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
                {phase.message}
              </p>
            )}
            {phase.kind === 'error' && phase.fareGone ? (
              <Button asChild size="lg" className="w-full">
                <Link href={searchUrlForOffer(booking.offer)}>{messages.trip.searchAgain}</Link>
              </Button>
            ) : (
              <Button size="lg" className="w-full" onClick={pay} disabled={busy} aria-busy={busy}>
                {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
                {phase.kind === 'error' ? `${messages.review.tryAgain} · ${total}` : messages.review.pay(total)}
              </Button>
            )}
            {phase.kind === 'opening' && <output className="text-center text-sm text-muted-foreground">{messages.review.openingCheckout}</output>}
          </>
        )}
      </section>

      {phase.kind === 'confirming' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 px-6 text-center">
          <Loader2 aria-hidden className="size-12 animate-spin text-primary" />
          <output aria-live="polite">
            <span className="block text-xl font-semibold">{messages.review.paymentReceived}</span>
            <span className="mt-1 block text-muted-foreground">{messages.review.confirmingBody}</span>
          </output>
        </div>
      )}
    </>
  );
}
