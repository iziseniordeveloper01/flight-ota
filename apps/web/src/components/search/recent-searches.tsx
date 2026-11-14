'use client';

import { searchDateBounds } from '@ota/contracts';
import { History } from 'lucide-react';
import Link from 'next/link';
import { formatLocalDate } from '@/lib/local-time';
import { messages } from '@/lib/messages';
import { recentToState, useRecentSearches } from '@/lib/recent-searches';
import { searchUrl } from '@/lib/search-params';

export function RecentSearches() {
  const recent = useRecentSearches();
  // A search whose departure is now in the past would only lead to an error page.
  const { first } = searchDateBounds();
  const usable = recent.filter((r) => r.depart >= first);
  if (usable.length === 0) return null;

  return (
    <section aria-labelledby="recent-heading" className="mt-4">
      <h2 id="recent-heading" className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <History aria-hidden className="size-4" />
        {messages.search.recent}
      </h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {usable.map((r) => (
          <li key={`${r.from}-${r.to}-${r.depart}-${r.return ?? ''}`}>
            <Link
              href={searchUrl(recentToState(r))}
              className="inline-flex min-h-11 items-center rounded-full border bg-card px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              {r.from} → {r.to} · {formatLocalDate(r.depart)}
              {r.return ? ` – ${formatLocalDate(r.return)}` : ''}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
