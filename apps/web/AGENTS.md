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
- **Show only the charge currency (INR):** offers, bags and seats → `displayPrice`; bookings →
  `booking.displayPrice` (breakdown) and ancillary `displayAmount`. Never render a supplier `price` (its
  currency differs and its base/taxes split doesn't add up in INR). Search sends `currency: INR` as a hint.
- **Contracts:** validate search input with `searchFlightsSchema` from `@ota/contracts` (via
  `validateSearch` in `src/lib/search-params.ts`) — the same schema the API uses.
- **API calls** only through `src/lib/api.ts` (timeouts, typed `ApiError` kinds). Query defaults in
  `src/app/providers.tsx`. Booking calls (`bookingApi`) go to our own `/api/bookings/*` route handlers,
  never to the API directly.
- **Booking BFF** (`src/app/api/bookings/**`, helpers in `src/server/`, all `import 'server-only'` except
  the pure `csrf.ts` / `booking-cookie.ts`): the guest token lives ONLY in the httpOnly cookie `bk_<id>`
  (SameSite=Lax, Secure in prod, 7 days) and is sent server-side as `X-Booking-Token`; it is stripped from
  the create response. Closed allow-list of proxied endpoints (ancillaries, seat-maps, details, checkout,
  confirm-demo, payment-order, payment-verify); paths are built by us, never from the request; only
  `details` and `payment-verify` pass a JSON body through (the API validates it). POST/PUT need `Origin` ===
  `WEB_ORIGIN` (403 otherwise). The confirm-demo Idempotency-Key is derived from the booking id
  (`confirm-<id>`). No cookie → 404 / the booking not-found page.
- **Payment (review page):** the server decides the panel: `booking.payment.provider === 'demo'` →
  `ConfirmPanel` (no money), otherwise `PayPanel`. `PayPanel`: terms → `payment-order` (new order every
  attempt) → `lib/razorpay-checkout.ts` injects `https://checkout.razorpay.com/v1/checkout.js` lazily (only
  when "Pay" is pressed; Razorpay's own retry is off) → success handler → `payment-verify` → "Payment
  received — confirming with the airline…" + poll GET every 3s (max 4 min) → complete page. Failed /
  dismissed → message + "Try again · ₹X". PAID/CONFIRMING → confirming screen; FAILED/REFUND_PENDING/
  REFUNDED → refund message with the amount. There is no CSP; if one is added, allow checkout.razorpay.com
  (script) and api.razorpay.com (frames).
- **Server env** (`src/server/env.ts`, never in client code): `API_INTERNAL_URL` (optional, defaults to
  `NEXT_PUBLIC_API_URL`) and `WEB_ORIGIN`. Server components call the API directly with the cookie.
- **Passenger PII** (names, DOB, passport) never goes to localStorage/sessionStorage/URLs. The step-1
  form keeps it in memory; a refresh restores it from GET booking (passport masked → `keepExisting`).
- **Fare gone:** a 410 (API code `FARE_NO_LONGER_AVAILABLE`, e.g. the checkout re-shop found no match or
  the airline's offer request was already booked) shows `messages.errors.fareGone` + "Search again" with
  the original search (`searchUrlForOffer`) — on the trip summary (`CheckoutButton`) and at confirmation.
- **Seat map:** fit-to-width — every row is a CSS grid with the cabin's shared columns; seat columns
  scale 28–44px (`minmax(1.75rem, 2.75rem)`, WCAG 2.2 target ≥ 24px), so a 3-4-3 fits 360px with no
  horizontal scroll; desktop gets 44px seats. Column letters sticky at the top of the map's own scroller,
  row number left of every row, "▲ Front of aircraft" above row 1. Paid seats use the `--seat-paid*`
  tokens (legend), never a "$" badge. Bottom bar: "Seat 14C · Window · $20.00 · Adult 1" (`findSeat`).
  Keys come from the fixed grid (segment-deck-row-section-column), never array indexes.
- **Stepper:** phones show only the active step's label (others number/check; labels stay for screen
  readers). Step 1 has a one-line demo notice (`DemoNote compact`); review shows the demo panel only next
  to Confirm (demo provider) or the test-mode note in the Pay panel; complete shows the references +
  "We've emailed your confirmation to {email}" + "Save these references…".
- **Booking form:** React Hook Form + `zodResolver(bookingFormSchema(ctx))` — the contract schema plus
  the booking's rules (age category at the last flight, name length, passport). Form values have the API
  body's shape, so server issues map back with `setError(path)` (`lib/booking-errors.ts`). Whether a
  passport is required comes from the server (ancillaries), never from the browser.
- **URL state:** search and filter/sort params via nuqs parsers in `src/lib/search-params.ts`.
- **Env:** public vars validated in `src/env.ts` (Zod). Read from the ROOT `.env` (next.config.ts loads
  it). `NEXT_PUBLIC_*` is inlined at build time — rebuild after changing it.
- Results pages are `noindex`. Keep the home page light (no images; hero text is the LCP element).
- shadcn components: add with `pnpm dlx shadcn@latest add <name>` from `apps/web`, then re-apply the
  44px sizing. Local edits to `components/ui/*` are marked with a comment.

## Layout
- `src/app` routes: `/` (home, server component + client `SearchWidget`), `/terms` + `/privacy` (noindex
  placeholders "… to be provided by <brand>", linked from the footer and the review page), `/flights/search` (results),
  `/flights/confirm?offer=` (trip summary), `/booking/[id]` (step 1), `/booking/[id]/review` (step 2,
  payment or demo confirm + polling + refund state), `/booking/[id]/complete` (step 3, printable);
  `/api/bookings/*` (BFF)
- `src/components/booking` stepper, countdown, trip details, passenger/contact cards, date selects,
  country select, phone field (lazy libphonenumber), extras (bags, seats, insurance), seat map, price
  summary, booking summary, confirm panel
- `src/server` server-only API access, cookie helpers, CSRF check, server env
- `src/components/search` widget, airport combobox, dates, passengers, recent searches
- `src/components/results` summary bar, date strip, sort tabs, filters, virtualised list, states
- `src/components/offer` offer card, details sheet (re-price), segment timeline
- `src/lib` pure logic (tested): local-time, money-format, passengers, offer-filters, offer-sort,
  search-params, recent-searches, api, messages, booking-form, booking-errors, booking-price,
  booking-steps, seat-selection, bag-selection, date-parts, phone, countries

## Commands (from repo root)
- `pnpm --filter @ota/web dev` (port 3000) · `build` · `typecheck` · `lint` (oxlint) · `test` (Vitest + RTL)
- E2E: `pnpm --filter @ota/web test:e2e` runs two suites:
  - `playwright.config.ts`: api on :4100 (`SUPPLIER=mock`, `PAYMENT_PROVIDER=demo`, Redis DB 15) + web on
    :3100 (build in `.next-e2e`) — the demo booking flow.
  - `playwright.payments.config.ts`: api on :4200 (`PAYMENT_PROVIDER=fake`, `NODE_ENV=test`, workers on,
    Redis DB 14) + web on :3200 (`.next-e2e-pay`) — `e2e/payments.spec.ts` with checkout.js replaced by a
    route-intercepted stub that signs like Razorpay, so CI never reaches Razorpay.
  Needs `pnpm db:up` + seeded airports, and `pnpm exec playwright install chromium`.
- Screenshots (manual, servers already running): `playwright test -c playwright.screenshots.config.ts`
  → `e2e/screenshots/` (git-ignored). Projects: mobile (390), mobile-360, desktop. With the mock,
  `SHOT_FROM=CDG SHOT_TO=JFK SHOT_AIRLINE=Direct SHOT_PHONE="06 12 34 56 78"` gives the 3-4-3 seat map.
- `e2e/mobile-layout.spec.ts`: 360/390px seat maps (3-4-3 and 3-3, no horizontal scroll, ≥ 28px seats),
  stepper labels, compact demo notice; desktop 44px seats.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
