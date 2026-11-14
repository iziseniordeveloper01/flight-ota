import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@ota/db';
import { Redis } from 'ioredis';
import { escapeLike } from '../common/escape-like.js';
import { withTimeout } from '../common/with-timeout.js';
import { PRISMA } from '../prisma/prisma.module.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import type { AirportSuggestion, SearchAirportsQuery } from './airports.schema.js';

// Airport data changes only when we re-seed, so a long TTL is safe.
// Bump the "v1" segment when the result shape or ranking changes, to orphan stale entries.
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_TIMEOUT_MS = 200;
const DB_TIMEOUT_MS = 2_000;

@Injectable()
export class AirportsService {
  private readonly logger = new Logger(AirportsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async search({ q, limit }: SearchAirportsQuery): Promise<AirportSuggestion[]> {
    const key = `airports:search:v1:${q.toLowerCase()}:${limit}`;

    const cached = await this.cacheGet(key);
    if (cached) return cached;

    const results = await this.queryDb(q, limit);
    await this.cacheSet(key, results);
    return results;
  }

  private queryDb(q: string, limit: number): Promise<AirportSuggestion[]> {
    const code = q.toUpperCase();
    const contains = `%${escapeLike(q)}%`;
    const prefix = `${escapeLike(q)}%`;

    // Tagged template: every ${} becomes a bound parameter ($1, $2...), never concatenated SQL.
    // ILIKE '%q%' and `%` (trigram similarity) are served by the *_trgm_idx GIN indexes.
    return withTimeout(
      this.prisma.$queryRaw<AirportSuggestion[]>`
        SELECT iata_code    AS "iataCode",
               name,
               city,
               country_code AS "countryCode",
               type
        FROM airports
        WHERE is_active
          AND (
            iata_code = ${code}
            OR city ILIKE ${contains}
            OR name ILIKE ${contains}
            OR keywords ILIKE ${contains}
            -- Fuzzy match catches typos like "dehli" → Delhi (pg_trgm similarity > 0.3).
            OR city % ${q}
          )
        ORDER BY
          (iata_code = ${code}) DESC,
          (city ILIKE ${prefix}) DESC,
          (name ILIKE ${prefix}) DESC,
          (type = 'large_airport') DESC,
          GREATEST(similarity(coalesce(city, ''), ${q}), similarity(name, ${q})) DESC,
          name ASC
        LIMIT ${limit}
      `,
      DB_TIMEOUT_MS,
      'airport search',
    );
  }

  // The cache is an optimisation only: any Redis problem falls through to the DB.
  private async cacheGet(key: string): Promise<AirportSuggestion[] | null> {
    // maxRetriesPerRequest: null queues commands while disconnected, so check status instead of waiting.
    if (this.redis.status !== 'ready') return null;
    try {
      const raw = await withTimeout(this.redis.get(key), CACHE_TIMEOUT_MS, 'airport cache get');
      return raw ? (JSON.parse(raw) as AirportSuggestion[]) : null;
    } catch (err) {
      this.logger.warn(`Cache read failed, using DB: ${(err as Error).message}`);
      return null;
    }
  }

  private async cacheSet(key: string, value: AirportSuggestion[]): Promise<void> {
    if (this.redis.status !== 'ready') return;
    try {
      await withTimeout(
        this.redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS),
        CACHE_TIMEOUT_MS,
        'airport cache set',
      );
    } catch (err) {
      this.logger.warn(`Cache write failed: ${(err as Error).message}`);
    }
  }
}
