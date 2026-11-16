import { Check } from 'lucide-react';
import { messages } from '@/lib/messages';
import { cn } from '@/lib/utils';

const STEPS = [messages.steps.booking, messages.steps.payment, messages.steps.complete];

/**
 * [1 Booking · 2 Payment · 3 Complete] — current step marked with aria-current. Phones show the label
 * of the active step only (others: number / check), so nothing truncates at 360px.
 */
export function BookingStepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav aria-label={messages.steps.label} className="print:hidden">
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          return (
            <li key={label} aria-current={active ? 'step' : undefined} className={cn('flex items-center gap-2', n < STEPS.length && 'flex-1')}>
              <span
                aria-hidden
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                  active && 'border-primary bg-primary text-primary-foreground',
                  done && 'border-primary bg-accent text-accent-foreground',
                  !active && !done && 'border-input text-muted-foreground',
                )}
              >
                {done ? <Check className="size-4" /> : n}
              </span>
              <span className={cn('text-sm whitespace-nowrap', active ? 'font-semibold' : 'sr-only text-muted-foreground md:not-sr-only')}>
                <span className="sr-only">{messages.steps.stepOf(n, STEPS.length)}: </span>
                {label}
              </span>
              {n < STEPS.length && <span aria-hidden className="h-px min-w-3 flex-1 bg-border" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
