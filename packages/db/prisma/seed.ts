// Idempotent seed: upserts airports from the committed prisma/data/airports.json.
// Run via `pnpm --filter "@ota/db" db:seed` (prisma.config.ts → migrations.seed).
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { createPrismaClient } from '../src/client.js';
import type { AirportSeed } from '../scripts/refresh-airports.js';

// Resolved from this file (not cwd) so the seed works no matter where it is launched from.
config({ path: resolve(import.meta.dirname, '../../../.env') });

const BATCH_SIZE = 500;
const DATA_DIR = resolve(import.meta.dirname, 'data');

// IATA code → extra search terms (old names, local names, common misspellings like "Dehli").
// airport-aliases.json is HAND-MAINTAINED, unlike airports.json which `data:airports` regenerates
// from OurAirports — keeping them apart means a refresh never wipes these. When search analytics
// show a query that returns nothing (e.g. a misspelling), add it to that airport's list there.
type AirportAliases = Record<string, string[]>;

async function readJson<T>(fileName: string): Promise<T> {
  return JSON.parse(await readFile(resolve(DATA_DIR, fileName), 'utf8')) as T;
}

// OurAirports keywords are a comma-separated list; split so duplicates of an alias
// (BOM already has "Bombay") are removed term by term, keeping the first spelling seen.
function mergeKeywords(keywords: string | null, aliases: string[] = []): string | null {
  const seen = new Map<string, string>();
  for (const term of [...(keywords?.split(',') ?? []), ...aliases]) {
    const trimmed = term.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) seen.set(key, trimmed);
  }
  return seen.size ? [...seen.values()].join(', ') : null;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const airports = await readJson<AirportSeed[]>('airports.json');
  const aliases = await readJson<AirportAliases>('airport-aliases.json');

  const codes = new Set(airports.map((a) => a.iataCode));
  for (const code of Object.keys(aliases)) {
    // Warn instead of failing: a stale alias must not block seeding the rest of the data.
    if (!codes.has(code)) console.warn(`Alias for unknown IATA code "${code}" ignored`);
  }

  // A one-off script needs few connections; keep the pool small so it can run beside the API.
  const prisma = createPrismaClient({ connectionString, maxConnections: 2 });
  try {
    for (let i = 0; i < airports.length; i += BATCH_SIZE) {
      const batch = airports.slice(i, i + BATCH_SIZE);
      // One transaction per batch: a failure rolls back that batch only, and re-running is safe.
      await prisma.$transaction(
        batch.map(({ iataCode, keywords, ...fields }) => {
          const data = { ...fields, keywords: mergeKeywords(keywords, aliases[iataCode]) };
          return prisma.airport.upsert({
            where: { iataCode },
            // isActive true on update too: re-activates an airport that came back into the data.
            create: { iataCode, ...data, isActive: true },
            update: { ...data, isActive: true },
          });
        }),
      );
    }
    console.log(`Upserted ${airports.length} airports`);

    // Deactivate instead of delete: bookings/search history may still reference old codes.
    const { count: deactivated } = await prisma.airport.updateMany({
      where: { isActive: true, iataCode: { notIn: [...codes] } },
      data: { isActive: false },
    });
    const active = await prisma.airport.count({ where: { isActive: true } });
    const total = await prisma.airport.count();
    console.log(`Deactivated ${deactivated} airports not in the file; ${active} active / ${total} total`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
