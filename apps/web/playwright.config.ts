import { defineConfig } from '@playwright/test';

// Dedicated ports so the E2E run never talks to (or collides with) your dev servers on 3000/4000.
const API_PORT = 4100;
const WEB_PORT = 3100;
const repoRoot = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/screenshots.spec.ts'], // manual run: playwright.screenshots.config.ts
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      // Mock supplier set in THIS process env (wins over the root .env), independent of your .env.
      // Needs Postgres + Redis (pnpm db:up) and the seeded airports for autocomplete.
      // Redis DB 15 is reserved for E2E and emptied first (see e2e/reset-redis.mjs for why).
      command:
        'pnpm --filter @ota/api build && node apps/web/e2e/reset-redis.mjs && node apps/api/dist/main.js',
      cwd: repoRoot,
      url: `http://localhost:${API_PORT}/v1/health`,
      env: {
        PORT: String(API_PORT),
        SUPPLIER: 'mock',
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        // Local docker-compose Redis (127.0.0.1:6379, see docker-compose.yml), dedicated DB 15.
        REDIS_URL: 'redis://127.0.0.1:6379/15',
      },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // NEXT_PUBLIC_* is inlined at build time, so this is its own build in its own distDir.
      command: `pnpm exec next build && pnpm exec next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      env: {
        NEXT_DIST_DIR: '.next-e2e',
        NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}/v1`,
      },
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
