// Empties the Redis DB used ONLY by the E2E API (REDIS_URL from the Playwright webServer env, DB 15).
// Why: every run starts from an empty cache (no cached searches or re-priced offers left by the
// previous run, so results don't depend on run order), and a dedicated DB keeps E2E from reading or
// writing the dev cache.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const url = process.env.REDIS_URL;
if (!url?.endsWith('/15')) {
  // Safety: never flush anything but the dedicated E2E database.
  console.error('reset-redis: refusing to run without a REDIS_URL ending in /15');
  process.exit(1);
}

// ioredis is an @ota/api dependency; resolve it from there.
const require = createRequire(new URL('../../api/package.json', import.meta.url));
const { Redis } = await import(pathToFileURL(require.resolve('ioredis')).href);
const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
await redis.connect();
await redis.flushdb();
await redis.quit();
