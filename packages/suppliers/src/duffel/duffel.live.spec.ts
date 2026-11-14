import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DuffelAdapter } from './duffel.adapter.js';

// Real network call to Duffel TEST mode. Opt-in only:
//   DUFFEL_LIVE_TEST=1 pnpm --filter "@ota/suppliers" test
const live = process.env.DUFFEL_LIVE_TEST === '1';

describe.skipIf(!live)('DuffelAdapter (live, test mode)', () => {
  it('LHR→JFK 30 days ahead returns offers', { timeout: 60_000 }, async () => {
    // The adapter never reads env; the test loads the root .env itself (Node 24 built-in).
    if (!process.env.DUFFEL_ACCESS_TOKEN) process.loadEnvFile(resolve(import.meta.dirname, '../../../../.env'));
    const token = process.env.DUFFEL_ACCESS_TOKEN ?? '';
    expect(token.startsWith('duffel_test_')).toBe(true); // never hit live mode from a test

    const departureDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const offers = await new DuffelAdapter({ accessToken: token }).search(
      { origin: 'LHR', destination: 'JFK', departureDate, adults: 1, children: 0, infants: 0, cabin: 'economy' },
      { timeoutMs: 45_000 },
    );

    expect(offers.length).toBeGreaterThan(0);
    // Duffel Airways (ZZ) is Duffel's test airline; usually present, but any offers pass.
    const hasZZ = offers.some((o) => o.owner.code === 'ZZ');
    expect(hasZZ || offers.length > 0).toBe(true);
  });
});
