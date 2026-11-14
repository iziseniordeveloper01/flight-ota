import { BadgeCheck, RefreshCw, Smartphone } from 'lucide-react';
import { RecentSearches } from '@/components/search/recent-searches';
import { SearchWidget } from '@/components/search/search-widget';
import { messages } from '@/lib/messages';

const TRUST_ICONS = [BadgeCheck, RefreshCw, Smartphone];

// Server component: only the widget and recent-search chips hydrate. No images, so the LCP
// element is the hero heading (text), which paints with the first HTML response.
export default function HomePage() {
  return (
    <>
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 pt-8 pb-24 md:pt-14 md:pb-28">
          <h1 className="text-3xl font-bold tracking-tight text-balance md:text-5xl">
            {messages.home.heroTitle}
          </h1>
          <p className="mt-3 max-w-2xl text-base text-pretty opacity-90 md:text-lg">
            {messages.home.heroSubtitle}
          </p>
        </div>
      </section>

      <div className="mx-auto -mt-20 max-w-6xl px-4">
        <div className="rounded-2xl border bg-card p-4 shadow-lg md:p-6">
          <SearchWidget />
        </div>
        <RecentSearches />
      </div>

      <section aria-labelledby="trust-heading" className="mx-auto mt-12 max-w-6xl px-4">
        <h2 id="trust-heading" className="text-xl font-semibold">
          {messages.home.trustTitle}
        </h2>
        <ul className="mt-4 grid gap-4 md:grid-cols-3">
          {messages.home.trust.map((point, i) => {
            const Icon = TRUST_ICONS[i];
            return (
              <li key={point.title} className="flex gap-3 rounded-xl border bg-card p-4">
                <Icon aria-hidden className="size-6 shrink-0 text-primary" />
                <div>
                  <h3 className="font-semibold">{point.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{point.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
