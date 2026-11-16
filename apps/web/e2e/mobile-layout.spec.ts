import { expect, test, type Locator, type Page } from '@playwright/test';
import { resultsUrl, startBooking } from './booking-helpers';

// Phone layout at the narrowest widths we support (mock supplier, see playwright.config.ts).
// Seat maps: CDG→JFK direct is a 3-4-3 wide-body in the mock (> 6h), LHR→SIN direct a 3-3.

test.describe.configure({ timeout: 120_000 });

const direct = (cards: Locator) => cards.filter({ hasText: 'Direct' }).first();

async function openSeatMap(page: Page) {
  await page.getByRole('region', { name: 'Seat selection' }).getByRole('button', { name: /^(Select|Change) seats$/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Select seats' });
  await expect(dialog.getByTestId('seat-columns')).toBeVisible({ timeout: 60_000 });
  return dialog;
}

const LAYOUTS = [
  { name: '3-4-3 wide-body', from: 'CDG', to: 'JFK', columns: 'ABCDEFGHJK', lastSeat: '30K' },
  { name: '3-3 narrow-body', from: 'LHR', to: 'SIN', columns: 'ABCDEF', lastSeat: '20F' },
];

for (const width of [360, 390]) {
  for (const layout of LAYOUTS) {
    test(`${width}px: ${layout.name} seat map fits the width, letters sticky, row numbers left`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile', 'phone widths');
      await page.setViewportSize({ width, height: 800 });
      await startBooking(page, resultsUrl(layout.from, layout.to), direct);
      const dialog = await openSeatMap(page);
      const scroller = dialog.getByTestId('seat-map-scroll');
      const header = dialog.getByTestId('seat-columns');
      await expect(header).toHaveText(layout.columns);
      await expect(dialog.getByTestId('seat-front')).toHaveText('▲ Front of aircraft');

      // No horizontal scroll: neither inside the map nor the page.
      const overflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const last = (await dialog.getByRole('button', { name: new RegExp(`^Seat ${layout.lastSeat},`) }).boundingBox())!;
      expect(last.x + last.width).toBeLessThanOrEqual(width);

      // Seats ≥ 28px (WCAG 2.2 target size needs 24px), no "$" badges.
      const seats = dialog.locator('button[data-status]');
      const sizes = await seats.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(27.9);
      expect(await seats.evaluateAll((els) => els.some((e) => e.textContent?.includes('$')))).toBe(false);

      // Row number on the left of its row.
      const row = dialog.getByTestId('seat-row-20');
      const numberBox = (await row.getByTestId('seat-row-number').boundingBox())!;
      const firstSeat = (await row.locator('button').first().boundingBox())!;
      expect(numberBox.x + numberBox.width).toBeLessThanOrEqual(firstSeat.x + 1);

      // The column letters stay pinned while the cabin scrolls.
      await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight / 2 }));
      await expect.poll(async () => Math.abs((await header.boundingBox())!.y - (await scroller.boundingBox())!.y)).toBeLessThan(2);

      // Tap a paid seat: the bottom bar says seat · position · price · passenger.
      await dialog.locator('button[data-status="paid"]').first().click();
      await expect(dialog.getByTestId('seat-footer')).toHaveText(/^Seat \d+[A-K] · (Window|Aisle|Middle) · \$\d+\.\d{2} · Adult 1$/);
    });
  }

  test(`${width}px: stepper shows only the active label; compact demo notice`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone widths');
    await page.setViewportSize({ width, height: 800 });
    await startBooking(page, resultsUrl('DEL', 'BOM'), direct);
    const labels = page.getByRole('navigation', { name: 'Booking progress' }).locator('li > span:nth-child(2)');
    const widths = await labels.evaluateAll((els) => els.map((e) => ({ width: e.getBoundingClientRect().width, clipped: e.scrollWidth > e.clientWidth + 1 })));
    expect(widths[0].width).toBeGreaterThan(20); // "Booking", the active step
    expect(widths[0].clipped).toBe(false);
    expect(widths.slice(1).every((w) => w.width <= 1)).toBe(true); // screen-reader only
    const note = page.getByRole('note').filter({ hasText: 'Demo booking' });
    expect((await note.boundingBox())!.height).toBeLessThan(40); // one line
  });
}

test('desktop keeps 44px seats on the 3-4-3 map', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop width');
  await startBooking(page, resultsUrl('CDG', 'JFK'), direct);
  const dialog = await openSeatMap(page);
  const sizes = await dialog.locator('button[data-status]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(43.5);
});
