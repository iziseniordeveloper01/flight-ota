import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FieldTriggerProps extends Omit<ComponentProps<'button'>, 'value'> {
  label: string;
  value: string | null;
  placeholder: string;
  icon?: ReactNode;
  /** id of the inline error element, wired via aria-describedby. */
  errorId?: string;
  hasError?: boolean;
}

/** Big tappable form field (label + value) that opens a picker. Accessible name = label + value. */
export function FieldTrigger({
  label,
  value,
  placeholder,
  icon,
  errorId,
  hasError,
  className,
  ...props
}: FieldTriggerProps) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      // aria-invalid is not valid on buttons; the error text is announced via aria-describedby.
      aria-describedby={hasError ? errorId : undefined}
      data-invalid={hasError || undefined}
      className={cn(
        'flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border border-input bg-card px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-invalid:border-2 data-invalid:border-destructive',
        className,
      )}
      {...props}
    >
      {icon && (
        <span aria-hidden className="text-muted-foreground [&_svg]:size-5">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {/* Space keeps the accessible name "From Delhi (DEL)", not "FromDelhi (DEL)". */}{' '}
        <span
          className={cn(
            'truncate text-base font-semibold',
            !value && 'font-normal text-muted-foreground',
          )}
        >
          {value ?? placeholder}
        </span>
      </span>
    </button>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm font-medium text-destructive">
      {message}
    </p>
  );
}
