import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Small form primitives for the booking pages: label + control + hint + inline error, wired with
// aria-describedby / aria-invalid. Controls are 44px tall (h-11) and use 16px text on phones.

export const errorId = (id: string) => `${id}-error`;

export function Field({
  id,
  label,
  error,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: ReactNode;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError id={errorId(id)}>{error}</FieldError>
    </div>
  );
}

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="text-sm font-medium text-destructive">
      {children}
    </p>
  );
}

/** Props that connect a control to its Field's error text. */
export function invalidProps(id: string, invalid: boolean) {
  return { id, 'aria-invalid': invalid || undefined, 'aria-describedby': invalid ? errorId(id) : undefined };
}

const controlClass =
  'h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm';

/** Native <select>: the platform picker is the best one on phones. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(controlClass, 'pr-8', className)} {...props} />;
}

export function SectionCard({
  title,
  description,
  children,
  id,
  action,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  id?: string;
  action?: ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-24 rounded-xl border bg-card p-4 md:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold">
            {title}
          </h2>
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
