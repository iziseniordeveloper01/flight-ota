import type { PublicFlightOffer } from '@ota/contracts';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { messages } from '@/lib/messages';
import { formatMoney } from '@/lib/money-format';
import { SORT_KEYS, type SortKey } from '@/lib/offer-sort';

/** Tab triggers only; the parent <Tabs> wraps the list in the active TabsContent (tabpanel). */
export function SortTabs({ leads }: { leads: Record<SortKey, PublicFlightOffer | undefined> }) {
  return (
    <TabsList aria-label={messages.sort.label} className="h-12 w-full">
      {SORT_KEYS.map((key) => {
        const lead = leads[key];
        return (
          <TabsTrigger key={key} value={key} className="flex-col gap-0 leading-tight">
            <span>{messages.sort[key]}</span>
            {lead && (
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {formatMoney(lead.price.total)}
              </span>
            )}
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}
