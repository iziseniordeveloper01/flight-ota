import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@ota/db';
import { bookingError } from '../bookings/booking-errors.js';
import { withTimeout } from '../common/with-timeout.js';
import type { Env } from '../config/env.js';
import { PRISMA } from '../prisma/prisma.module.js';
import { JsonCacheService } from '../redis/json-cache.service.js';
import { FX_RATE_SOURCE, type FxRateSource } from './fx-rate-source.js';
import { identitySnapshot, type FxSnapshot } from './pricing.js';

export const FX_CACHE_TTL_SECONDS = 6 * 60 * 60;
/** A stored rate younger than this may stand in while the FX API is down. */
export const FX_FALLBACK_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const DB_TIMEOUT_MS = 3_000;
// A fallback rate is re-cached briefly so an outage doesn't mean one DB query per request.
const FALLBACK_CACHE_TTL_SECONDS = 5 * 60;

interface CachedRate {
  rate: string;
  source: string;
  fetchedAt: string;
}

// The source is part of the key (and of the fallback lookup) so rates of a test source never
// mix with real ones on a shared Redis/DB.
const cacheKey = (source: string, base: string, quote: string) => `fx:rate:v1:${source}:${base}:${quote}`;

/**
 * Exchange rates: Redis (6h) → FX API (persisted to fx_rates) → last stored rate if < 48h old →
 * 503 FX_UNAVAILABLE. Same currency → rate 1, no buffer.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  // One fetch per pair at a time in this process (a cold cache must not fan out to the API).
  private readonly inFlight = new Map<string, Promise<FxSnapshot>>();

  constructor(
    @Inject(FX_RATE_SOURCE) private readonly source: FxRateSource,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly cache: JsonCacheService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async snapshot(base: string, quote: string): Promise<FxSnapshot> {
    if (base === quote) return identitySnapshot(base);
    const key = cacheKey(this.source.name, base, quote);
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const promise = this.resolve(base, quote).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private async resolve(base: string, quote: string): Promise<FxSnapshot> {
    const bufferPercent = this.config.get('FX_BUFFER_PERCENT', { infer: true });
    const key = cacheKey(this.source.name, base, quote);
    const cached = await this.cache.get<CachedRate>(key);
    if (cached) return { base, quote, bufferPercent, ...cached };

    try {
      const rate = await this.source.fetchRate(base, quote, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const fetchedAt = new Date();
      const entry: CachedRate = { rate, source: this.source.name, fetchedAt: fetchedAt.toISOString() };
      await this.persist(base, quote, entry, fetchedAt);
      await this.cache.set(key, entry, FX_CACHE_TTL_SECONDS);
      return { base, quote, bufferPercent, ...entry };
    } catch (err) {
      this.logger.warn(`FX fetch failed ${base}->${quote}: ${(err as Error).message}`);
    }

    const stored = await this.lastStored(base, quote);
    if (stored && Date.now() - stored.fetchedAt.getTime() < FX_FALLBACK_MAX_AGE_MS) {
      const entry: CachedRate = { rate: stored.rate.toFixed(), source: `${stored.source}:stored`, fetchedAt: stored.fetchedAt.toISOString() };
      await this.cache.set(key, entry, FALLBACK_CACHE_TTL_SECONDS);
      return { base, quote, bufferPercent, ...entry };
    }
    this.logger.error(`No usable FX rate ${base}->${quote} (API down, no stored rate < 48h)`);
    throw bookingError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'FX_UNAVAILABLE',
      'Prices in your currency are temporarily unavailable. Please try again in a few minutes.',
    );
  }

  // History + fallback. A failed insert never blocks pricing (the rate itself is fine).
  private async persist(base: string, quote: string, entry: CachedRate, fetchedAt: Date): Promise<void> {
    try {
      await withTimeout(
        this.prisma.fxRate.create({ data: { base, quote, rate: entry.rate, source: entry.source, fetchedAt } }),
        DB_TIMEOUT_MS,
        'fx rate insert',
      );
    } catch (err) {
      this.logger.warn(`FX rate not persisted: ${(err as Error).message}`);
    }
  }

  private async lastStored(base: string, quote: string) {
    try {
      return await withTimeout(
        this.prisma.fxRate.findFirst({ where: { base, quote, source: this.source.name }, orderBy: { fetchedAt: 'desc' } }),
        DB_TIMEOUT_MS,
        'fx rate lookup',
      );
    } catch (err) {
      this.logger.warn(`FX fallback lookup failed: ${(err as Error).message}`);
      return null;
    }
  }
}
