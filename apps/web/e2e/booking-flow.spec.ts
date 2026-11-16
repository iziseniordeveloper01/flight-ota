import { expect, test, type Locator } from '@playwright/test';
import {
  ADULT,
  addFirstBag,
  addInsurance,
  confirmDemo,
  continueToReview,
  fillContact,
  fillPassenger,
  pickCountry,
  pickFirstSeat,
  resultsUrl,
  startBooking,
} from './booking-helpers';

// Booking flow against the real API on SUPPLIER=mock (see playwright.config.ts). Mock scenarios:
// family name PRICECHANGE → the airline re-prices at confirmation (packages/suppliers/AGENTS.md).

test.describe.configure({ timeout: 120_000 });

// Domestic tests take a DIRECT DEL→BOM offer: a connection via a foreign hub is an international
// trip, where the server (rightly) asks for passports.
const direct = (cards: Locator) => cards.filter({ hasText: 'Direct' }).first();

const PASSPORT = { number: 'Z1234567', country: 'India', expiry: { day: '1', month: 'January', year: String(new Date().getUTCFullYear() + 8) } };

test('DEL → BOM: 1 adult, bag + seat + insurance → review → confirm → PNR', async ({ page }) => {
  await startBooking(page, resultsUrl('DEL', 'BOM'), direct);
  await expect(page.getByText(/Complete your booking within/)).toBeVisible();

  await fillPassenger(page, 'Adult 1', ADULT);
  // Domestic (server-decided): no passport fields.
  await expect(page.getByLabel('Passport number', { exact: true })).toHaveCount(0);
  await fillContact(page, 'guest@e2e.test', '98765 43210');
  await addFirstBag(page);
  await pickFirstSeat(page);
  await addInsurance(page);
  await expect(page.getByText(/^Adult 1: Seat \d+[A-K] · /)).toBeVisible();

  await continueToReview(page);
  const demo = page.getByRole('region', { name: 'Demo booking' });
  await expect(demo.getByRole('link', { name: 'Terms and Conditions' })).toHaveAttribute('href', '/terms');
  await expect(demo.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  await expect(page.getByText('Arjun Tester').first()).toBeVisible();
  await expect(page.getByText('Travel Protection (Demo)')).toBeVisible();
  await expect(page.getByText(/^Adult 1 · Seat \d+[A-K] · DEL → BOM$/)).toBeVisible();
  await expect(page.getByText(/^Adult 1 · 1 × \d+kg checked bag$/)).toBeVisible();

  await confirmDemo(page);
  await expect(page).toHaveURL(/\/complete$/, { timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Booking confirmed' })).toBeVisible();
  await expect(page.getByTestId('pnr')).toHaveText(/^[A-Z0-9]{6}$/);
  await expect(page.getByText('Test booking — no real ticket issued.')).toBeVisible();
  await expect(page.getByText(/DEMO-[A-Z0-9]+/).first()).toBeVisible();
  await expect(page.getByText('Save these references — you’ll need them to manage your booking.')).toBeVisible();
  await expect(page.getByText(/Total paid|Confirmation details for/)).toHaveCount(0);
});

test('DEL → DXB (international): passport fields appear and are saved masked', async ({ page }) => {
  await startBooking(page, resultsUrl('DEL', 'DXB'));
  await expect(page.getByLabel('Passport number', { exact: true })).toBeVisible();

  // The client validates before anything is sent: an empty passport blocks Continue.
  await fillPassenger(page, 'Adult 1', ADULT);
  await fillContact(page, 'guest@e2e.test', '98765 43210');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Please check the highlighted fields.')).toBeVisible();
  await expect(page.getByLabel('Passport number', { exact: true })).toBeFocused();

  const card = page.getByRole('region', { name: 'Adult 1' });
  await card.getByLabel('Passport number', { exact: true }).fill(PASSPORT.number);
  await pickCountry(page, card, 'Issuing country', PASSPORT.country);
  await card.getByLabel('Passport expiry date: Day', { exact: true }).selectOption(PASSPORT.expiry.day);
  await card.getByLabel('Passport expiry date: Month', { exact: true }).selectOption({ label: PASSPORT.expiry.month });
  await card.getByLabel('Passport expiry date: Year', { exact: true }).selectOption(PASSPORT.expiry.year);

  await continueToReview(page);
  await expect(page.getByText(/Passport \*{5}567/)).toBeVisible();
  // The full number never reaches the page.
  expect(await page.content()).not.toContain(PASSPORT.number);
});

test('2 adults + 1 infant: the infant travels on Adult 2’s lap', async ({ page }) => {
  await startBooking(page, resultsUrl('DEL', 'BOM', { adults: 2, infants: 1 }), direct);
  const lastYear = String(new Date().getUTCFullYear() - 1);

  await fillPassenger(page, 'Adult 1', ADULT);
  await fillPassenger(page, 'Adult 2', { ...ADULT, title: 'Ms', given: 'Meera', dob: { day: '2', month: 'June', year: '1988' } });
  await fillPassenger(page, 'Infant 1', {
    title: 'Miss',
    given: 'Asha',
    family: 'Tester',
    dob: { day: '1', month: 'January', year: lastYear },
    nationality: 'India',
    travelsWith: 'Adult 2',
  });
  await fillContact(page, 'family@e2e.test', '98765 43210');

  await continueToReview(page);
  await expect(page.getByText(/Travels with Adult 2/)).toBeVisible();
  await confirmDemo(page);
  await expect(page).toHaveURL(/\/complete$/, { timeout: 90_000 });
  await expect(page.getByTestId('pnr')).toHaveText(/^[A-Z0-9]{6}$/);
});

test('airline re-prices at confirmation (PRICECHANGE) → clear failure + new search', async ({ page }) => {
  await startBooking(page, resultsUrl('DEL', 'BOM'), direct);
  await fillPassenger(page, 'Adult 1', { ...ADULT, family: 'PRICECHANGE' });
  await fillContact(page, 'guest@e2e.test', '98765 43210');
  await continueToReview(page);
  await confirmDemo(page);

  const alert = page.getByRole('alert').filter({ hasText: 'We could not confirm this booking' });
  await expect(alert).toBeVisible({ timeout: 90_000 });
  await expect(alert).toContainText(/changed the price from .+ to .+/);
  await expect(alert).toContainText('You have not been charged.');
  await expect(alert.getByRole('link', { name: 'Start a new search' })).toHaveAttribute('href', /\/flights\/search\?from=DEL&to=BOM/);
});

test('a booking opened without its cookie (another browser) → not found page', async ({ page, browser }) => {
  const id = await startBooking(page, resultsUrl('DEL', 'BOM'), direct);

  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto(`/booking/${id}`);
  await expect(stranger.getByRole('heading', { name: 'Booking not found or opened on another device' })).toBeVisible();
  await expect(stranger.getByRole('link', { name: 'Go to home page' })).toHaveAttribute('href', '/');
  // The BFF answers the same 404 to API calls without the cookie.
  const res = await stranger.request.get(`/api/bookings/${id}`);
  expect(res.status()).toBe(404);
  await other.close();
});

test('the BFF rejects cross-origin booking mutations (CSRF)', async ({ request }) => {
  const res = await request.post('/api/bookings', {
    data: { offerId: 'mock:abc' },
    headers: { Origin: 'https://evil.example' },
  });
  expect(res.status()).toBe(403);
  const noOrigin = await request.put('/api/bookings/01936d7e-0000-7000-8000-000000000000/details', { data: {} });
  expect(noOrigin.status()).toBe(403);
});
