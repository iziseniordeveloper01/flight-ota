import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResultsSkeleton } from '@/components/results/result-states';
import { ResultsView } from '@/components/results/results-view';
import { messages } from '@/lib/messages';

// Search results are per-query, volatile and endless in number: keep them out of search engines.
export const metadata: Metadata = {
  title: messages.meta.resultsTitle,
  robots: { index: false, follow: false },
};

export default function FlightSearchPage() {
  return (
    // The view reads the URL query (useSearchParams via nuqs), which needs a Suspense boundary
    // so the rest of the page can be prerendered.
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <ResultsSkeleton />
        </div>
      }
    >
      <ResultsView />
    </Suspense>
  );
}
