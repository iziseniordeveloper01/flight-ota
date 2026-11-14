// Regenerates prisma/data/airports.json from OurAirports (Public Domain).
// The JSON is committed so seeding is offline and reproducible; run this only to refresh the data.
//   pnpm --filter "@ota/db" data:airports
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';

const SOURCE_URL =
  'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';
const OUTPUT_PATH = resolve(import.meta.dirname, '../prisma/data/airports.json');
const FETCH_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;

export interface AirportSeed {
  iataCode: string;
  icaoCode: string | null;
  name: string;
  city: string | null;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  type: 'large_airport' | 'medium_airport';
  keywords: string | null;
}

// Only the OurAirports columns we read; the CSV has more.
interface OurAirportsRow {
  type: string;
  name: string;
  latitude_deg: string;
  longitude_deg: string;
  iso_country: string;
  municipality: string;
  scheduled_service: string;
  icao_code: string;
  iata_code: string;
  keywords: string;
}

const ALLOWED_TYPES = new Set(['large_airport', 'medium_airport']);

async function download(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      console.warn(`Download attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(err as Error).message}`);
      if (attempt < MAX_ATTEMPTS) {
        // Linear backoff (2s, 4s): enough to ride out a flaky connection without stalling long.
        await new Promise((r) => setTimeout(r, attempt * 2_000));
      }
    }
  }
  throw lastError;
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toCoordinate(value: string): number | null {
  const n = Number.parseFloat(value);
  // Matches the DB column Decimal(9, 6); rounding here keeps the committed JSON diff-stable.
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
}

function toSeed(row: OurAirportsRow): AirportSeed | null {
  const iataCode = row.iata_code.trim().toUpperCase();
  const countryCode = row.iso_country.trim().toUpperCase();
  if (!ALLOWED_TYPES.has(row.type)) return null;
  // Airports without scheduled service never appear in flight search results.
  if (row.scheduled_service !== 'yes') return null;
  if (!/^[A-Z]{3}$/.test(iataCode)) return null;
  if (!/^[A-Z]{2}$/.test(countryCode)) return null;

  const icao = row.icao_code.trim().toUpperCase();
  return {
    iataCode,
    icaoCode: /^[A-Z0-9]{4}$/.test(icao) ? icao : null,
    name: row.name.trim(),
    city: emptyToNull(row.municipality),
    countryCode,
    latitude: toCoordinate(row.latitude_deg),
    longitude: toCoordinate(row.longitude_deg),
    type: row.type as AirportSeed['type'],
    keywords: emptyToNull(row.keywords),
  };
}

async function main(): Promise<void> {
  console.log(`Downloading ${SOURCE_URL} ...`);
  const csv = await download(SOURCE_URL);
  const rows = parse(csv, { columns: true, skip_empty_lines: true }) as OurAirportsRow[];
  console.log(`Parsed ${rows.length} rows`);

  const byIata = new Map<string, AirportSeed>();
  let duplicates = 0;
  for (const row of rows) {
    const seed = toSeed(row);
    if (!seed) continue;
    const existing = byIata.get(seed.iataCode);
    if (existing) {
      duplicates++;
      // The IATA code is our primary key, so keep one row; a large airport is the likelier real owner.
      if (existing.type !== 'large_airport' && seed.type === 'large_airport') {
        byIata.set(seed.iataCode, seed);
      }
      continue;
    }
    byIata.set(seed.iataCode, seed);
  }

  const airports = [...byIata.values()].sort((a, b) => a.iataCode.localeCompare(b.iataCode));
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  // Trailing newline keeps git and editors from flagging "no newline at end of file".
  await writeFile(OUTPUT_PATH, `${JSON.stringify(airports, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${airports.length} airports (${duplicates} duplicate IATA codes resolved) to ${OUTPUT_PATH}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
