import { searchDateBounds } from '@ota/contracts';
import Link from 'next/link';
import { addDays, dayDiff, formatLocalDate } from '@/lib/local-time';
import { messages } from '@/lib/messages';
import { searchUrl, type SearchState } from '@/lib/search-params';
import { cn } from '@/lib/utils';

const RANGE = 3;

/**
 * ±3 days around the departure date as plain links (no price lookups yet). A round trip keeps its
 * length: the return date moves by the same number of days.
 */
export function DateStrip({ search }: { search: SearchState & { depart: string } }) {
  const { first, last } = searchDateBounds();
  const days = Array.from({ length: RANGE * 2 + 1 }, (_, i) => addDays(search.depart, i - RANGE));

  return (
    <nav aria-label={messages.results.dateStrip}>
      <ul className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const shift = dayDiff(search.depart, day);
          const ret = search.return ? addDays(search.return, shift) : null;
          const current = shift === 0;
          const outOfRange = day < first || day > last || (ret !== null && ret > last);
          const content = (
            <>
              <span className="text-xs">{formatLocalDate(day, 'dow')}</span>
              {/* text-xs on phones: 7 columns at 360px leave ~43px each. */}
              <span className="text-xs font-semibold whitespace-nowrap md:text-sm">{formatLocalDate(day)}</span>
            </>
          );
          const base = 'flex min-h-14 flex-col items-center justify-center rounded-lg px-0.5 text-center';
          return (
            <li key={day}>
              {outOfRange ? (
                <span aria-disabled className={cn(base, 'text-muted-foreground opacity-50')}>
                  {content}
                </span>
              ) : (
                <Link
                  href={searchUrl({ ...search, depart: day, return: ret })}
                  aria-current={current ? 'date' : undefined}
                  className={cn(
                    base,
                    current
                      ? 'bg-primary text-primary-foreground'
                      : 'border bg-card hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
