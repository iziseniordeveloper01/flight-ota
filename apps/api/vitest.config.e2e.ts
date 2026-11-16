import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Win over the root .env (process.env has priority): no real payments, no workers unless a
    // suite turns them on (createTestApp({ workers: true }) with its own queue prefix).
    env: { PAYMENT_PROVIDER: 'demo', WORKERS_ENABLED: 'false', QUEUE_PREFIX: 'e2e', SUPPLIER: 'mock' },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
