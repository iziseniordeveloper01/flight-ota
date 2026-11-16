import { defineConfig } from '@playwright/test';

// Real-payment UI flow against the API with PAYMENT_PROVIDER=fake (in-process Razorpay double; only
// allowed with NODE_ENV=test) and a mocked checkout.js (route intercept in e2e/payments.spec.ts),
// so CI never reaches Razorpay. Own ports, own Redis DB, own Next build (NEXT_PUBLIC_API_URL differs).
const API_PORT = 4200;
const WEB_PORT = 3200;
const repoRoot = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/payments.spec.ts'],
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
  webServer: [
    {
      command: 'pnpm --filter @ota/api build && node apps/web/e2e/reset-redis.mjs && node apps/api/dist/main.js',
      cwd: repoRoot,
      url: `http://localhost:${API_PORT}/v1/health`,
      env: {
        PORT: String(API_PORT),
        NODE_ENV: 'test',
        SUPPLIER: 'mock',
        PAYMENT_PROVIDER: 'fake',
        WORKERS_ENABLED: 'true', // the ticketing worker books after payment
        QUEUE_PREFIX: 'e2e-pw-pay',
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        REDIS_URL: 'redis://127.0.0.1:6379/14',
      },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `pnpm exec next build && pnpm exec next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      env: {
        NEXT_DIST_DIR: '.next-e2e-pay',
        NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}/v1`,
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
      },
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
