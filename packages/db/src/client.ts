import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  connectionString: string;
  /** Max pooled connections per process. Keep low: N app instances × this must stay under Postgres max_connections. */
  maxConnections?: number;
}

// The library never reads env vars itself — the caller passes the URL.
// That keeps this package usable from api, admin, scripts and tests alike.
export function createPrismaClient({ connectionString, maxConnections = 10 }: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    max: maxConnections,
    // Prisma 7 + pg default is 0 = wait forever for a connection. Fail fast instead.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  return new PrismaClient({ adapter });
}