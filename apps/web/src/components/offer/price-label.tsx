import type { Money } from '@ota/contracts';
import { formatMoney } from '@/lib/money-format';
import { messages } from '@/lib/messages';
import { cn } from '@/lib/utils';

/** "$402.00 · total for 3 travellers" (or "· total price" for one traveller). */
export function PriceLabel({
  total,
  travellers,
  className,
  amountClassName,
}: {
  total: Money;
  travellers: number;
  className?: string;
  amountClassName?: string;
}) {
  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-1.5', className)}>
      <span className={cn('text-xl font-bold tabular-nums', amountClassName)}>{formatMoney(total)}</span>
      <span className="text-xs text-muted-foreground">
        · {travellers > 1 ? messages.offer.totalFor(travellers) : messages.offer.totalPrice}
      </span>
    </p>
  );
}
