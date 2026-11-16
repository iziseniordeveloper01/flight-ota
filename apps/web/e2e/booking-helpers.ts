import { expect, type Locator, type Page } from '@playwright/test';

// Shared steps for the booking specs (mock e2e) and the live screenshot run. Test data only —
// never real names or documents.

export function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export function resultsUrl(from: string, to: string, opts: { depart?: string; adults?: number; infants?: number } = {}): string {
  const qs = new URLSearchParams({
    from,
    to,
    depart: opts.depart ?? isoInDays(30),
    adults: String(opts.adults ?? 1),
    children: '0',
    infants: String(opts.infants ?? 0),
    cabin: 'economy',
  });
  return `/flights/search?${qs}`;
}

/** Results → offer sheet → trip summary → Checkout → step 1. Returns the booking id. */
export async function startBooking(
  page: Page,
  url: string,
  pickCard?: (cards: Locator) => Locator,
  onTripSummary?: () => Promise<unknown>,
): Promise<string> {
  await page.goto(url);
  const cards = page.getByTestId('offer-card');
  await expect(cards.first()).toBeVisible();
  await (pickCard ? pickCard(cards) : cards.first()).getByRole('button', { name: /^Select / }).click();
  const sheet = page.getByRole('dialog', { name: 'Flight details' });
  await expect(sheet.getByText(/^Total$/)).toBeVisible();
  await sheet.getByRole('link', { name: 'Continue to booking' }).click();

  await expect(page).toHaveURL(/\/flights\/confirm\?offer=/);
  await expect(page.getByRole('heading', { level: 1, name: 'Trip summary' })).toBeVisible();
  if (onTripSummary) await onTripSummary();
  await page.getByRole('button', { name: 'Checkout' }).click();
  await expect(page).toHaveURL(/\/booking\/[0-9a-f-]{36}(\?|$)/, { timeout: 60_000 });
  await expect(page.getByRole('region', { name: 'Adult 1' })).toBeVisible();
  return /\/booking\/([0-9a-f-]{36})/.exec(page.url())![1];
}

export async function pickCountry(page: Page, card: Locator, label: string, country: string) {
  await card.getByRole('button', { name: new RegExp(`^${label}:`) }).click();
  const search = page.getByRole('combobox', { name: 'Search country' });
  await search.fill(country);
  await page.getByRole('option', { name: country, exact: true }).click();
  await expect(card.getByRole('button', { name: `${label}: ${country}` })).toBeVisible();
}

async function pickDate(card: Locator, label: string, date: { day: string; month: string; year: string }) {
  await card.getByLabel(`${label}: Day`, { exact: true }).selectOption(date.day);
  await card.getByLabel(`${label}: Month`, { exact: true }).selectOption({ label: date.month });
  await card.getByLabel(`${label}: Year`, { exact: true }).selectOption(date.year);
}

export interface PassengerInput {
  title: string;
  given: string;
  family: string;
  dob: { day: string; month: string; year: string };
  nationality: string;
  passport?: { number: string; country: string; expiry: { day: string; month: string; year: string } };
  travelsWith?: string;
}

export async function fillPassenger(page: Page, label: string, p: PassengerInput) {
  const card = page.getByRole('region', { name: label });
  await card.getByLabel('Title', { exact: true }).selectOption({ label: p.title });
  await card.getByLabel('Given name(s)', { exact: true }).fill(p.given);
  await card.getByLabel('Family name', { exact: true }).fill(p.family);
  await pickDate(card, 'Date of birth', p.dob);
  await pickCountry(page, card, 'Nationality', p.nationality);
  if (p.travelsWith) await card.getByLabel('Travels on the lap of', { exact: true }).selectOption({ label: p.travelsWith });
  if (p.passport) {
    await card.getByLabel('Passport number', { exact: true }).fill(p.passport.number);
    await pickCountry(page, card, 'Issuing country', p.passport.country);
    await pickDate(card, 'Passport expiry date', p.passport.expiry);
  }
}

export async function fillContact(page: Page, email: string, mobile: string) {
  const card = page.getByRole('region', { name: 'Contact details' });
  await card.getByRole('checkbox', { name: 'Same as Adult 1' }).click();
  await card.getByLabel('Email', { exact: true }).fill(email);
  // The calling-code list appears once libphonenumber has loaded.
  await expect(card.getByRole('combobox', { name: 'Country code' })).toBeEnabled();
  await card.getByRole('textbox', { name: 'Mobile number' }).fill(mobile);
}

export async function addFirstBag(page: Page) {
  const select = page.getByRole('region', { name: 'Extra baggage' }).getByRole('combobox').first();
  await select.selectOption({ index: 1 });
}

/** Opens the seat map for the first flight and picks the first bookable seat. */
export async function pickFirstSeat(page: Page, shot?: (name: string) => Promise<unknown>): Promise<void> {
  await page.getByRole('region', { name: 'Seat selection' }).getByRole('button', { name: /^(Select|Change) seats$/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Select seats' });
  const seat = dialog.locator('button[data-status="paid"], button[data-status="free"]').first();
  await expect(seat).toBeVisible({ timeout: 60_000 });
  await seat.click();
  await expect(dialog.locator('button[data-status="selected"]')).toHaveCount(1);
  if (shot) await shot('seat-map');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

export async function addInsurance(page: Page) {
  await page.getByRole('checkbox', { name: /^Add travel insurance for / }).click();
}

export async function continueToReview(page: Page) {
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/review$/, { timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Review your booking' })).toBeVisible();
}

export async function confirmDemo(page: Page) {
  await page.getByRole('checkbox', { name: /I agree to the Terms and Conditions/ }).click();
  await page.getByRole('button', { name: 'Confirm booking (demo)' }).click();
}

export const ADULT: PassengerInput = {
  title: 'Mr',
  given: 'Arjun',
  family: 'Tester',
  dob: { day: '15', month: 'March', year: '1985' },
  nationality: 'India',
};
