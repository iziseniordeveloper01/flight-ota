import { expect, test, type Page } from '@playwright/test';

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
