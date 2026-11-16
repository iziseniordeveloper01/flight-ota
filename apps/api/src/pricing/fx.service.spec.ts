import type { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@ota/db';
import type { Env } from '../config/env.js';
import type { JsonCacheService } from '../redis/json-cache.service.js';
import { FrankfurterRateSource, type FxRateSource } from './fx-rate-source.js';
import { FX_CACHE_TTL_SECONDS, FxService } from './fx.service.js';

function setup(opts: { cached?: object | null; fetch?: () => Promise<string>; stored?: { rate: string; fetchedAt: Date; source: string } | null } = {}) {
  const cache = { get: vi.fn().mockResolvedValue(opts.cached ?? null), set: vi.fn().mockResolvedValue(undefined) };
  const prisma = {
    fxRate: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(opts.stored ? { ...opts.stored, rate: { toFixed: () => opts.stored!.rate } } : null),
    },
  };
  const fetchRate = vi.fn(opts.fetch ?? (async () => '94.11'));
  const source: FxRateSource = { name: 'frankfurter', fetchRate };
  const config = { get: (key: keyof Env) => ({ FX_BUFFER_PERCENT: '2' })[key as 'FX_BUFFER_PERCENT'] };
  const service = new FxService(source, prisma as unknown as PrismaClient, cache as unknown as JsonCacheService, config as unknown as ConfigService<Env, true>);
  return { service, cache, prisma, fetchRate };
}

describe('FxService', () => {
  it('same currency → rate 1, no buffer, no lookup', async () => {
    const { service, fetchRate } = setup();
    expect(await service.snapshot('INR', 'INR')).toMatchObject({ rate: '1', bufferPercent: '0', source: 'identity' });
    expect(fetchRate).not.toHaveBeenCalled();
  });

  it('cache hit → no API call', async () => {
    const { service, fetchRate } = setup({ cached: { rate: '90', source: 'frankfurter', fetchedAt: '2026-11-16T00:00:00.000Z' } });
    expect(await service.snapshot('USD', 'INR')).toMatchObject({ base: 'USD', quote: 'INR', rate: '90', bufferPercent: '2' });
    expect(fetchRate).not.toHaveBeenCalled();
  });

  it('miss → fetch, persist to fx_rates and cache 6h', async () => {
    const { service, cache, prisma } = setup();
    expect(await service.snapshot('USD', 'INR')).toMatchObject({ rate: '94.11', source: 'frankfurter' });
    expect(prisma.fxRate.create).toHaveBeenCalledWith({ data: expect.objectContaining({ base: 'USD', quote: 'INR', rate: '94.11', source: 'frankfurter' }) });
    expect(cache.set).toHaveBeenCalledWith('fx:rate:v1:frankfurter:USD:INR', expect.objectContaining({ rate: '94.11' }), FX_CACHE_TTL_SECONDS);
  });

  it('concurrent misses share one fetch', async () => {
    const { service, fetchRate } = setup();
    await Promise.all([service.snapshot('USD', 'INR'), service.snapshot('USD', 'INR'), service.snapshot('USD', 'INR')]);
    expect(fetchRate).toHaveBeenCalledTimes(1);
  });

  it('API down → last stored rate if younger than 48h (marked :stored)', async () => {
    const fetchedAt = new Date(Date.now() - 47 * 3_600_000);
    const { service, prisma } = setup({ fetch: () => Promise.reject(new Error('down')), stored: { rate: '93.5', fetchedAt, source: 'frankfurter' } });
    expect(await service.snapshot('USD', 'INR')).toMatchObject({ rate: '93.5', source: 'frankfurter:stored', fetchedAt: fetchedAt.toISOString() });
    expect(prisma.fxRate.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { base: 'USD', quote: 'INR', source: 'frankfurter' } }));
  });

  it('API down and stored rate older than 48h (or none) → 503 FX_UNAVAILABLE', async () => {
    const old = setup({ fetch: () => Promise.reject(new Error('down')), stored: { rate: '93.5', fetchedAt: new Date(Date.now() - 49 * 3_600_000), source: 'frankfurter' } });
    await expect(old.service.snapshot('USD', 'INR')).rejects.toMatchObject({ status: 503, response: { code: 'FX_UNAVAILABLE' } });
    const none = setup({ fetch: () => Promise.reject(new Error('down')) });
    await expect(none.service.snapshot('USD', 'INR')).rejects.toMatchObject({ status: 503 });
  });
});

describe('FrankfurterRateSource', () => {
  const signal = new AbortController().signal;
  const fakeFetch = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('GET /v2/rate/{base}/{quote}, passes the AbortSignal, reads the v2 shape', async () => {
    const f = fakeFetch(200, { date: '2026-11-16', base: 'USD', quote: 'INR', rate: 94.11 });
    expect(await new FrankfurterRateSource('https://api.frankfurter.dev', f).fetchRate('USD', 'INR', { signal })).toBe('94.11');
    expect(f).toHaveBeenCalledWith('https://api.frankfurter.dev/v2/rate/USD/INR', expect.objectContaining({ signal }));
  });

  it('throws on HTTP errors, wrong pairs and unexpected bodies', async () => {
    await expect(new FrankfurterRateSource('https://x', fakeFetch(404, {})).fetchRate('USD', 'INR', { signal })).rejects.toThrow(/404/);
    await expect(new FrankfurterRateSource('https://x', fakeFetch(200, { date: 'd', base: 'EUR', quote: 'INR', rate: 1 })).fetchRate('USD', 'INR', { signal })).rejects.toThrow(/pair/);
    await expect(new FrankfurterRateSource('https://x', fakeFetch(200, [{ rate: 1 }])).fetchRate('USD', 'INR', { signal })).rejects.toThrow();
  });
});
