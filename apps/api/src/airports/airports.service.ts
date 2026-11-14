import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@ota/db';
import { escapeLike } from '../common/escape-like.js';
import { withTimeout } from '../common/with-timeout.js';
import { PRISMA } from '../prisma/prisma.module.js';
import { JsonCacheService } from '../redis/json-cache.service.js';
import type { AirportSuggestion, SearchAirportsQuery } from './airports.schema.js';

// Airport data changes only when we re-seed, so a long TTL is safe.
// Bump the "v1" segment when the result shape or ranking changes, to orphan stale entries.
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const DB_TIMEOUT_MS = 2_000;

@Injectable()
export class AirportsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly cache: JsonCacheService,
  ) {}

  async search({ q, limit }: SearchAirportsQuery): Promise<AirportSuggestion[]> {
    const key = `airports:search:v1:${q.toLowerCase()}:${limit}`;

    // Cache failures come back as a miss, so search falls through to the DB.
    const cached = await this.cache.get<AirportSuggestion[]>(key);
    if (cached) return cached;

    const results = await this.queryDb(q, limit);
    await this.cache.set(key, results, CACHE_TTL_SECONDS);
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
}
