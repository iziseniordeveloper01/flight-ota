import { expect, test, type Page } from '@playwright/test';
import {
  ADULT,
  addFirstBag,
  addInsurance,
  confirmDemo,
  continueToReview,
  fillContact,
  fillPassenger,
  pickFirstSeat,
  resultsUrl,
  startBooking,
} from './booking-helpers';

// Screenshots of home, results and the offer sheet (see playwright.screenshots.config.ts).
// Navigates by URL to keep it about the visuals; the search-flow spec covers the interactions.

const from = process.env.SHOT_FROM ?? 'LHR';
const to = process.env.SHOT_TO ?? 'JFK';
const depart = process.env.SHOT_DEPART; // YYYY-MM-DD; default: 30 days ahead

// Airline logos are lazy-loaded images: wait for the ones on screen before capturing. Hidden ones
// (e.g. the desktop filter sidebar on phones) never load, so only rendered, in-viewport images count.
async function onScreenImagesLoaded(page: Page) {
  await page.waitForFunction(() =>
    [...document.images]
      .filter((i) => {
        const r = i.getBoundingClientRect();
        return i.getClientRects().length > 0 && r.bottom > 0 && r.top < window.innerHeight;
      })
      .every((i) => i.complete),
  );
}

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test('home, results, offer sheet', async ({ page }, testInfo) => {
  const dir = 'e2e/screenshots';
  const name = testInfo.project.name;

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({ path: `${dir}/home-${name}.png`, fullPage: true });

  const date = depart ?? isoInDays(30);
  await page.goto(`/flights/search?from=${from}&to=${to}&depart=${date}&adults=1&children=0&infants=0&cabin=economy`);
  const firstCard = page.getByTestId('offer-card').first();
  await expect(firstCard).toBeVisible();
  await onScreenImagesLoaded(page);
  await page.screenshot({ path: `${dir}/results-${name}.png` });

  await firstCard.getByRole('button', { name: /^Select / }).click();
  const details = page.getByRole('dialog', { name: 'Flight details' });
  await expect(details.getByText(/^Total$/)).toBeVisible();
  await onScreenImagesLoaded(page);
  await page.screenshot({ path: `${dir}/offer-${name}.png` });
});

// Full booking (books for real in the supplier's TEST environment — e.g. Duffel test mode): trip
// summary, step 1, seat map, review, complete. SHOT_AIRLINE picks the offer (default Duffel Airways).
// Test data only; prints the PNR, our reference and the total (no passenger data).
const airline = process.env.SHOT_AIRLINE ?? 'Duffel Airways';

test('booking flow: trip summary, booking page, seat map, review, complete', async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const dir = 'e2e/screenshots';
  const name = testInfo.project.name;
  const shot = (step: string, fullPage = false) => page.screenshot({ path: `${dir}/${step}-${name}.png`, fullPage });

  await startBooking(
    page,
    resultsUrl(from, to, { depart: depart ?? isoInDays(30) }),
    (cards) => cards.filter({ hasText: airline }).first(),
    async () => {
      await onScreenImagesLoaded(page);
      await shot('trip-summary');
    },
  );
  await onScreenImagesLoaded(page);
  await shot('booking-top');

  const passport = { number: 'Z1234567', country: 'India', expiry: { day: '1', month: 'January', year: String(new Date().getUTCFullYear() + 8) } };
  const needsPassport = (await page.getByLabel('Passport number').count()) > 0;
  await fillPassenger(page, 'Adult 1', { ...ADULT, ...(needsPassport ? { passport } : {}) });
  // The calling code defaults to the origin airport's country (LHR → +44): a UK test mobile.
  await fillContact(page, 'guest@example.com', process.env.SHOT_PHONE ?? '07400 123456');
  await addFirstBag(page);
  await pickFirstSeat(page, (step) => shot(step));
  await addInsurance(page);

  await continueToReview(page);
  await shot('review', true);
  await confirmDemo(page);
  await expect(page).toHaveURL(/\/complete$/, { timeout: 240_000 });
  await expect(page.getByTestId('pnr')).toHaveText(/^[A-Z0-9]{5,8}$/);
  await shot('complete', true);

  const pnr = await page.getByTestId('pnr').textContent();
  const reference = await page.getByTestId('booking-reference').textContent();
  const total = await page.getByRole('region', { name: 'Price breakdown' }).locator('dd').last().textContent();
  console.log(`[${name}] PNR=${pnr} reference=${reference} total=${total}`);
});
