import { AlertCircle, Info, SearchX } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { messages } from '@/lib/messages';
import { cn } from '@/lib/utils';

export function DemoBanner() {
  return (
    <p role="note" className="flex items-start gap-2 rounded-lg bg-warning px-3 py-2 text-sm font-medium text-warning-foreground">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      {messages.results.demo}
    </p>
  );
}

export function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <output className="sr-only">{messages.results.loading}</output>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} aria-hidden className="rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-32" />
          <div className="mt-4 flex items-center justify-between gap-4">
            <Skeleton className="h-10 w-14" />
            <Skeleton className="h-2 flex-1" />
            <Skeleton className="h-10 w-14" />
          </div>
          <div className="mt-4 flex items-center justify-between border-t pt-3">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-11 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border bg-card px-4 py-10 text-center">
      <SearchX aria-hidden className="size-8 text-muted-foreground" />
      <h2 className="text-lg font-semibold">{title}</h2>
      {body && <p className="text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Message per error kind: 504 "taking too long", 502 "unavailable", 400 the API's own message. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : messages.errors.server;
}

export function ErrorState({
  error,
  onRetry,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  // Retrying a rejected (400) request gives the same answer, so no Retry button for it.
  const retryable = !(error instanceof ApiError && error.kind === 'validation');
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border bg-card text-center',
        compact ? 'p-4' : 'px-4 py-10',
      )}
    >
      <AlertCircle aria-hidden className="size-8 text-destructive" />
      <p className="font-semibold">{errorMessage(error)}</p>
      {retryable && onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-1">
          {messages.results.retry}
        </Button>
      )}
    </div>
  );
}

export function InvalidSearch({ details }: { details: string[] }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-10 text-center">
        <AlertCircle aria-hidden className="size-8 text-destructive" />
        <h1 className="text-xl font-semibold">{messages.results.invalidTitle}</h1>
        <p className="text-sm text-muted-foreground">{messages.results.invalidBody}</p>
        {details.length > 0 && (
          <ul className="text-sm text-muted-foreground">
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        <Button asChild className="mt-2">
          <Link href="/">{messages.results.backHome}</Link>
        </Button>
      </div>
    </div>
  );
}
