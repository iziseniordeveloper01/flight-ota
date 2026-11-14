import type { PublicFlightOffer } from '@ota/contracts';
import { otherOperators } from '@/lib/codeshare';
import { messages } from '@/lib/messages';
import { cn } from '@/lib/utils';

/** "Operated by …" once, under the owner's name, when another airline flies any segment. */
export function OperatedByNote({ offer, className }: { offer: PublicFlightOffer; className?: string }) {
  const operators = otherOperators(offer);
  if (operators.length === 0) return null;
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>{messages.offer.operatedBy(operators.join(', '))}</p>
  );
}
