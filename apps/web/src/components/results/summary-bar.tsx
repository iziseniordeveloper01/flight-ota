'use client';

import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-overlay';
import { SearchWidget } from '@/components/search/search-widget';
import { Button } from '@/components/ui/button';
import { formatLocalDate } from '@/lib/local-time';
import { messages } from '@/lib/messages';
import type { SearchState } from '@/lib/search-params';

/** Sticky compact summary: "DEL → BOM · 15 Dec · 1 adult · Economy" + Edit. */
export function SummaryBar({ search }: { search: SearchState & { depart: string; from: string; to: string } }) {
  const [editing, setEditing] = useState(false);
  const dates = search.return
    ? `${formatLocalDate(search.depart)} – ${formatLocalDate(search.return)}`
    : formatLocalDate(search.depart);
  const details = [
    dates,
    messages.pax.summary(search.adults, search.children, search.infants),
    messages.cabin[search.cabin],
  ].join(' · ');

  return (
    <div className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur supports-backdrop-filter:bg-card/80">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">
            {search.from} <span aria-hidden>→</span>
            <span className="sr-only"> to </span> {search.to}
          </h1>
          <p className="truncate text-sm text-muted-foreground">{details}</p>
        </div>
        <Button variant="outline" onClick={() => setEditing(true)} aria-label={messages.results.editTitle}>
          <Pencil aria-hidden />
          {messages.results.edit}
        </Button>
      </div>
      <ResponsiveDialog
        open={editing}
        onOpenChange={setEditing}
        title={messages.results.editTitle}
        className="sm:max-w-2xl"
      >
        <SearchWidget initial={search} layout="stacked" onSubmitted={() => setEditing(false)} />
      </ResponsiveDialog>
    </div>
  );
}
