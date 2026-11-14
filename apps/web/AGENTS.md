# @ota/web — agent notes

Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui (Radix), TanStack Query,
nuqs. Talks only to `@ota/api` over HTTP; types and schemas come from `@ota/contracts`.

## Rules
- **Mobile-first.** Base styles target 360–430px; enhance with `md:` (768) and `lg:` (1024). Every tap
  target ≥ 44px (`h-11`/`size-11`; shadcn Button/Input/Calendar/Command were resized for this). No
  horizontal page scroll at 360px. Pickers: full-screen sheet on phones, popover from md
  (`components/responsive-overlay.tsx`); content overlays: bottom sheet / dialog.
- **Design tokens:** brand colours ONLY in `src/styles/tokens.css` (CSS variables, AA contrast noted).
  `src/app/globals.css` maps them to Tailwind. Components never hard-code colours. Brand name comes from
  `NEXT_PUBLIC_BRAND_NAME`.
- **UI strings:** every user-facing string lives in `src/lib/messages.ts` (future i18n catalogue).
- **Time strings:** segment/slice times are airport-local `YYYY-MM-DDTHH:mm:ss` without offset. Format
  them only with `src/lib/local-time.ts` (`formatLocalTime`, `formatLocalDate`, `dayDiff`, ...), never
  `new Date(str)` / `toLocaleString`. Unit tests run with `TZ=America/Los_Angeles` to catch shifts.
- **Money:** decimal strings. Display with `formatMoney` (Intl formats the string exactly); compare with
  `compareMoney` / BigInt minor units (`moneyToMinor`). Never `Number()`/`parseFloat` an amount.
- **Contracts:** validate search input with `searchFlightsSchema` from `@ota/contracts` (via
  `validateSearch` in `src/lib/search-params.ts`) — the same schema the API uses.
- **API calls** only through `src/lib/api.ts` (timeouts, typed `ApiError` kinds). Query defaults in
  `src/app/providers.tsx`.
- **URL state:** search and filter/sort params via nuqs parsers in `src/lib/search-params.ts`.
- **Env:** public vars validated in `src/env.ts` (Zod). Read from the ROOT `.env` (next.config.ts loads
  it). `NEXT_PUBLIC_*` is inlined at build time — rebuild after changing it.
- Results pages are `noindex`. Keep the home page light (no images; hero text is the LCP element).
- shadcn components: add with `pnpm dlx shadcn@latest add <name>` from `apps/web`, then re-apply the
  44px sizing. Local edits to `components/ui/*` are marked with a comment.

## Layout
- `src/app` routes: `/` (home, server component + client `SearchWidget`), `/flights/search` (results)
- `src/components/search` widget, airport combobox, dates, passengers, recent searches
- `src/components/results` summary bar, date strip, sort tabs, filters, virtualised list, states
- `src/components/offer` offer card, details sheet (re-price), segment timeline
- `src/lib` pure logic (tested): local-time, money-format, passengers, offer-filters, offer-sort,
  search-params, recent-searches, api, messages

## Commands (from repo root)
- `pnpm --filter @ota/web dev` (port 3000) · `build` · `typecheck` · `lint` (oxlint) · `test` (Vitest + RTL)
- E2E: `pnpm --filter @ota/web test:e2e` — starts its own api on :4100 (`SUPPLIER=mock`) and web on :3100
  (build in `.next-e2e`). Needs `pnpm db:up` + seeded airports, and `pnpm exec playwright install chromium`.
- Screenshots (manual, servers already running): `playwright test -c playwright.screenshots.config.ts`
  → `e2e/screenshots/` (git-ignored).
