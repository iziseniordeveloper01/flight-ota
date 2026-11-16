import { expect, test } from '@playwright/test';
import { ADULT, continueToReview, fillContact, fillPassenger, resultsUrl, startBooking } from './booking-helpers';

// Real-payment UI (playwright.payments.config.ts: API with PAYMENT_PROVIDER=fake). checkout.js is
// replaced by a stub, so no request ever reaches Razorpay. The stub signs like Razorpay does —
// HMAC-SHA256(order_id|payment_id) with the fake provider's test secret — and the API verifies it.
const FAKE_KEY_SECRET = 'fake_key_secret'; // = apps/api/src/payments/fake-payment.provider.ts

const CHECKOUT_STUB = `
window.Razorpay = class {
  constructor(options) { this.options = options; this.handlers = {}; window.__rzpOpened = (window.__rzpOpened || 0) + 1; window.__rzpLastOptions = options; }
  on(event, fn) { this.handlers[event] = fn; }
  async open() {
    const o = this.options;
    const mode = window.__rzpMode || 'success';
    await new Promise((r) => setTimeout(r, 50));
    if (mode === 'dismiss') return o.modal && o.modal.ondismiss && o.modal.ondismiss();
    if (mode === 'failure') return this.handlers['payment.failed'] && this.handlers['payment.failed']({ error: { code: 'BAD_REQUEST_ERROR', reason: 'payment_failed' } });
    const paymentId = 'pay_' + o.order_id.slice('order_'.length);
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(${JSON.stringify(FAKE_KEY_SECRET)}), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(o.order_id + '|' + paymentId));
    const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
    o.handler({ razorpay_payment_id: paymentId, razorpay_order_id: o.order_id, razorpay_signature: hex });
  }
};`;

test.describe.configure({ timeout: 150_000 });

test('DEL → BOM: Pay ₹ — failed payment → Try again (new order) → paid → confirming → PNR + emailed', async ({ page }) => {
  const checkoutRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith('https://checkout.razorpay.com/')) checkoutRequests.push(r.url());
  });
  await page.route('https://checkout.razorpay.com/v1/checkout.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: CHECKOUT_STUB }),
  );
  await page.addInitScript(() => {
    (window as unknown as { __rzpMode: string }).__rzpMode = 'failure';
  });

  await startBooking(page, resultsUrl('DEL', 'BOM'), (cards) => cards.filter({ hasText: 'Direct' }).first());
  // Prices are INR everywhere (search results were too).
  await fillPassenger(page, 'Adult 1', ADULT);
  await fillContact(page, 'payer@e2e.test', '98765 43210');
  await continueToReview(page);
  expect(checkoutRequests).toEqual([]); // checkout.js is loaded lazily, only when paying

  const panel = page.getByRole('region', { name: 'Payment' });
  await expect(panel.getByText(/Test mode/)).toBeVisible();
  const pay = panel.getByRole('button', { name: /^Pay ₹[\d,]+(\.\d{2})?$/ });
  await expect(pay).toBeVisible();
  await expect(page.getByRole('region', { name: 'Demo booking' })).toHaveCount(0);

  // Terms first.
  await pay.click();
  await expect(page.getByText('Please accept the Terms and Conditions to continue')).toBeVisible();
  await panel.getByRole('checkbox', { name: /I agree to the Terms and Conditions/ }).click();

  // 1st attempt: the bank declines.
  await pay.click();
  await expect(panel.getByText('Your payment didn’t go through and no money was taken. Please try again.')).toBeVisible();
  expect(checkoutRequests).toHaveLength(1);
  const firstOrder = await page.evaluate(() => (window as unknown as { __rzpLastOptions: { order_id: string; amount: number; currency: string } }).__rzpLastOptions);
  expect(firstOrder.currency).toBe('INR');
  expect(firstOrder.amount).toBeGreaterThan(0);

  // Try again = a NEW order; this time it succeeds.
  await page.evaluate(() => {
    (window as unknown as { __rzpMode: string }).__rzpMode = 'success';
  });
  await panel.getByRole('button', { name: /^Try again · ₹/ }).click();
  await page.waitForFunction(() => (window as unknown as { __rzpOpened?: number }).__rzpOpened === 2);
  const secondOrder = await page.evaluate(() => (window as unknown as { __rzpLastOptions: { order_id: string } }).__rzpLastOptions);
  expect(secondOrder.order_id).not.toBe(firstOrder.order_id);

  await expect(page).toHaveURL(/\/complete$/, { timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Booking confirmed' })).toBeVisible();
  await expect(page.getByTestId('pnr')).toHaveText(/^[A-Z0-9]{6}$/);
  await expect(page.getByTestId('emailed')).toHaveText("We've emailed your confirmation to payer@e2e.test.");
  await expect(page.getByText(/₹[\d,]+/).first()).toBeVisible();
});

test('closing the checkout without paying → friendly message, booking still payable', async ({ page }) => {
  await page.route('https://checkout.razorpay.com/v1/checkout.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: CHECKOUT_STUB }),
  );
  await page.addInitScript(() => {
    (window as unknown as { __rzpMode: string }).__rzpMode = 'dismiss';
  });
  await startBooking(page, resultsUrl('DEL', 'BOM'), (cards) => cards.filter({ hasText: 'Direct' }).first());
  await fillPassenger(page, 'Adult 1', ADULT);
  await fillContact(page, 'payer@e2e.test', '98765 43210');
  await continueToReview(page);
  const panel = page.getByRole('region', { name: 'Payment' });
  await panel.getByRole('checkbox', { name: /I agree to the Terms and Conditions/ }).click();
  await panel.getByRole('button', { name: /^Pay ₹/ }).click();
  await expect(panel.getByText('Payment was cancelled. You can try again when you’re ready.')).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Try again · ₹/ })).toBeEnabled();
});
