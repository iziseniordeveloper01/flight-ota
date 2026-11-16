import { defineConfig } from '@playwright/test';

// Manual visual check against ALREADY RUNNING servers (no webServer here), e.g. api with
// SUPPLIER=duffel on :4000 and `pnpm --filter @ota/web start` on :3000:
//   SHOT_FROM=LHR SHOT_TO=JFK pnpm --filter @ota/web exec playwright test -c playwright.screenshots.config.ts
// Output: e2e/screenshots/*.png (git-ignored).
export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/screenshots.spec.ts'],
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 60_000 }, // live supplier searches can take a while
  use: { baseURL: process.env.SHOT_BASE_URL ?? 'http://localhost:3000' },
  projects: [
    {
      name: 'mobile',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      // The narrowest phone we support.
      name: 'mobile-360',
      use: { browserName: 'chromium', viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
    },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
  ],
});
