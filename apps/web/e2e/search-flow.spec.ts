import { expect, test, type Page } from '@playwright/test';

// Full happy path against the real API on SUPPLIER=mock (see playwright.config.ts webServer).

async function pickAirport(page: Page, field: 'From' | 'To', query: string, code: string) {
  await page.getByRole('button', { name: new RegExp(`^${field}\\b`) }).click();
  const input = page.getByRole('combobox', { name: new RegExp(`Search ${field.toLowerCase()} airport`, 'i') });
  await input.fill(query);
  await page.getByRole('option', { name: new RegExp(`\\(${code}\\)`) }).first().click();
  await expect(page.getByRole('button', { name: new RegExp(`^${field}.*\\(${code}\\)`) })).toBeVisible();
}

test('search DEL → BOM, filter direct, open offer details', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await pickAirport(page, 'From', 'Delhi', 'DEL');
  await pickAirport(page, 'To', 'Mumbai', 'BOM');

  // Dates: next month, the 15th (always inside the bookable window).
  await page.getByRole('button', { name: /^Depart/ }).click();
  await page.getByRole('button', { name: /next month/i }).click();
  await page.getByRole('gridcell').getByRole('button', { name: /15/ }).first().click();
  await expect(page.getByRole('button', { name: /^Depart.*15/ })).toBeVisible();

  await page.getByRole('button', { name: 'Search flights' }).click();

  await expect(page).toHaveURL(/\/flights\/search\?from=DEL&to=BOM&depart=\d{4}-\d{2}-15&adults=1/);
  await expect(page.getByText(/Demo mode — prices and flights are test data/)).toBeVisible();
  await expect(page.getByTestId('offer-card').first()).toBeVisible();

  // Direct filter: bottom sheet with Apply on phones, live sidebar on desktop.
  const isMobile = (page.viewportSize()?.width ?? 0) < 1024;
  if (isMobile) {
    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await sheet.getByRole('checkbox', { name: /Direct/ }).click();
    await sheet.getByRole('button', { name: /^Show \d+ flights?$/ }).click();
    await expect(page.getByRole('button', { name: 'Filters (1)' })).toBeVisible();
  } else {
    await page.getByRole('complementary', { name: 'Filters' }).getByRole('checkbox', { name: /Direct/ }).click();
  }
  await expect(page).toHaveURL(/stops=0/);

  const cards = page.getByTestId('offer-card');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  for (let i = 0; i < count; i++) await expect(cards.nth(i)).toContainText('Direct');

  // Open the first offer: details sheet re-prices and shows the total.
  await cards.first().getByRole('button', { name: /^Select / }).click();
  const details = page.getByRole('dialog', { name: 'Flight details' });
  await expect(details).toBeVisible();
  await expect(details.getByText(/Price confirmed with the airline|Price updated from/)).toBeVisible();
  await expect(details.getByText(/^Total$/)).toBeVisible();
  await expect(details.getByText(/₹\d[\d,]*\.\d{2}/).first()).toBeVisible();
  await expect(details.getByRole('link', { name: 'Continue to booking' })).toHaveAttribute('href', /^\/flights\/confirm\?offer=mock%3A/);
});

test('footer links to the placeholder Terms and Privacy pages (noindex)', async ({ page }) => {
  for (const [name, path] of [
    ['Terms and Conditions', '/terms'],
    ['Privacy Policy', '/privacy'],
  ] as const) {
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('link', { name }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText(new RegExp(`^${name} — to be provided by .+\\.$`))).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  }
});
