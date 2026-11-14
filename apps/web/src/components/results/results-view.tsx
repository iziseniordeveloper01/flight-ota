'use client';

import type { PublicFlightOffer, SearchFlightsBody } from '@ota/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useQueryStates } from 'nuqs';
import { useMemo, useState } from 'react';
import { OfferDetailsSheet } from '@/components/offer/offer-details';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { messages } from '@/lib/messages';
import { activeFilterCount, applyFilters, filterFacets, singleCurrency, type OfferFilters } from '@/lib/offer-filters';
import { leadOffers, sortOffers, type SortKey } from '@/lib/offer-sort';
import { totalTravellers } from '@/lib/passengers';
import {
  RESET_FILTER_PARAMS,
  filterParsers,
  filtersFromParams,
  filtersToParams,
  searchParsers,
  validateSearch,
  type SearchState,
} from '@/lib/search-params';
import { DateStrip } from './date-strip';
import { FiltersPanel, MobileFilters } from './filters';
import { OfferList } from './offer-list';
import { DemoBanner, EmptyState, ErrorState, InvalidSearch, ResultsSkeleton } from './result-states';
import { SortTabs } from './sort-tabs';
import { SummaryBar } from './summary-bar';

export function ResultsView() {
  const [search] = useQueryStates(searchParsers);
  const validation = useMemo(() => validateSearch(search), [search]);

  if (!validation.ok) return <InvalidSearch details={Object.values(validation.errors)} />;
  // After validation these are present; narrow the type for the children.
  const valid = search as SearchState & { from: string; to: string; depart: string };
  return <Results search={valid} body={validation.body} />;
}

function Results({
  search,
  body,
}: {
  search: SearchState & { from: string; to: string; depart: string };
  body: SearchFlightsBody;
}) {
  const queryClient = useQueryClient();
  // history "replace": toggling filters should not fill the back button with every click.
  const [params, setParams] = useQueryStates(filterParsers, { history: 'replace', scroll: false });
  const [selected, setSelected] = useState<PublicFlightOffer | null>(null);

  const queryKey = ['flights', body] as const;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.searchFlights(body, signal),
    staleTime: 5 * 60_000,
  });

  const offers = useMemo(() => query.data?.data ?? [], [query.data]);
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const facets = useMemo(() => filterFacets(offers), [offers]);
  const filtered = useMemo(() => applyFilters(offers, filters), [offers, filters]);
  const sorted = useMemo(() => sortOffers(filtered, params.sort), [filtered, params.sort]);
  const leads = useMemo(() => leadOffers(filtered), [filtered]);
  const travellers = totalTravellers(body);

  const setFilters = (next: OfferFilters) => void setParams(filtersToParams(next));
  const resetFilters = () => void setParams(RESET_FILTER_PARAMS);

  function refreshSearch() {
    setSelected(null);
    void queryClient.invalidateQueries({ queryKey });
  }

  const loaded = query.isSuccess;
  const mixedCurrency = loaded && offers.length > 0 && singleCurrency(offers) === null;

  return (
    <>
      <SummaryBar search={search} />
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pt-4">
        <DateStrip search={search} />
        {query.data?.meta.demo && <DemoBanner />}

        <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-6">
          {loaded && offers.length > 0 && (
            <aside aria-label={messages.filters.title} className="hidden lg:block">
              <div className="sticky top-20 rounded-xl border bg-card p-4">
                <FiltersPanel idPrefix="d" value={filters} onChange={setFilters} facets={facets} />
                {activeFilterCount(filters) > 0 && (
                  <Button variant="outline" className="mt-4 w-full" onClick={resetFilters}>
                    {messages.filters.reset}
                  </Button>
                )}
              </div>
            </aside>
          )}

          <section aria-label={messages.results.count(sorted.length)} className="lg:col-start-2 min-w-0">
            {query.isPending && <ResultsSkeleton />}
            {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
            {loaded && offers.length === 0 && (
              <EmptyState title={messages.results.emptyTitle} body={messages.results.emptyBody} />
            )}
            {loaded && offers.length > 0 && (
              <Tabs value={params.sort} onValueChange={(v) => void setParams({ sort: v as SortKey })}>
                <SortTabs leads={leads} />
                <div className="mt-1 flex items-center justify-between gap-3">
                  {/* h2: page outline is h1 (route) → h2 (results) → h3 (each offer). */}
                  <h2 aria-live="polite" className="text-sm font-normal text-muted-foreground">
                    {messages.results.count(sorted.length)}
                  </h2>
                  <div className="lg:hidden">
                    <MobileFilters value={filters} onApply={setFilters} facets={facets} offers={offers} />
                  </div>
                </div>
                {mixedCurrency && <p className="text-sm text-muted-foreground">{messages.results.mixedCurrency}</p>}
                <TabsContent value={params.sort} className="mt-2">
                  {sorted.length === 0 ? (
                    <EmptyState
                      title={messages.results.filteredEmptyTitle}
                      action={<Button onClick={resetFilters}>{messages.results.resetFilters}</Button>}
                    />
                  ) : (
                    <OfferList offers={sorted} travellers={travellers} onSelect={setSelected} />
                  )}
                </TabsContent>
              </Tabs>
            )}
          </section>
        </div>
      </div>
      <OfferDetailsSheet
        offer={selected}
        travellers={travellers}
        onClose={() => setSelected(null)}
        onRefreshSearch={refreshSearch}
      />
    </>
  );
}
