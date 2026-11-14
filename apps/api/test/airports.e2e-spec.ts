import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { Redis } from 'ioredis';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { REDIS_CLIENT } from './../src/redis/redis.module.js';
import type { AirportSuggestion } from './../src/airports/airports.schema.js';

// Requires the seeded database (pnpm --filter "@ota/db" db:seed) and Redis running.
describe('Airports (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    // Wait for Redis so the cache path is exercised too (search still works without it).
    const redis = app.get<Redis>(REDIS_CLIENT);
    if (redis.status !== 'ready') {
      await new Promise<void>((resolve) => redis.once('ready', () => resolve()));
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  const search = (query: string) => request(app.getHttpServer()).get(`/v1/airports?${query}`);

  it('q=del → exact IATA match ranks first', async () => {
    const res = await search('q=del').expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.body.data[0].iataCode).toBe('DEL');
  });

  it('q=mumbai → includes BOM', async () => {
    const res = await search('q=mumbai').expect(200);
    const codes = (res.body.data as AirportSuggestion[]).map((a) => a.iataCode);
    expect(codes).toContain('BOM');
  });

  // The next two rely on airport-aliases.json being merged into keywords by the seed.
  it('q=dehli (misspelling alias) → DEL first', async () => {
    const res = await search('q=dehli').expect(200);
    expect(res.body.data[0].iataCode).toBe('DEL');
  });

  it('q=bombay (old name) → includes BOM', async () => {
    const res = await search('q=bombay').expect(200);
    const codes = (res.body.data as AirportSuggestion[]).map((a) => a.iataCode);
    expect(codes).toContain('BOM');
  });

  it('q=lon&limit=3 → at most 3 results', async () => {
    const res = await search('q=lon&limit=3').expect(200);
    expect(res.body.data.length).toBeLessThanOrEqual(3);
  });

  it('q=d → 400 validation error', async () => {
    const res = await search('q=d').expect(400);
    expect(res.body.message).toBe('Validation failed');
    // Error responses must not be cacheable by browsers/CDN.
    expect(res.headers['cache-control'] ?? '').not.toContain('public');
  });

  it('q=%% → 200 with no results (LIKE wildcards are escaped)', async () => {
    const res = await search('q=%25%25').expect(200);
    expect(res.body.data).toEqual([]);
  });
});
