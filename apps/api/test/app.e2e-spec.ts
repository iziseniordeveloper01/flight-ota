import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { Redis } from 'ioredis';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { REDIS_CLIENT } from './../src/redis/redis.module.js';

describe('API (e2e)', () => {
  let app: INestApplication<App>;

  // One app for the whole suite: booting Nest + Redis per test is slow and adds nothing here.
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    // The client connects asynchronously; without this the first health check can race
    // the connection and report redis 'down'.
    const redis = app.get<Redis>(REDIS_CLIENT);
    if (redis.status !== 'ready') {
      await new Promise<void>((resolve) => redis.once('ready', () => resolve()));
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /v1/health → 200 with redis and database up', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.redis).toBe('up');
    expect(res.body.checks.database).toBe('up');
  });

  it('GET /health → 404 (global /v1 prefix is enforced)', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('sets helmet security headers', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
