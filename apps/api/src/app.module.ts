import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { RedisModule } from './redis/redis.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AirportsModule } from './airports/airports.module.js';
import { FlightsModule } from './flights/flights.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Single .env at the monorepo root, resolved from this file instead of cwd.
      // src/ and dist/ sit at the same depth, so the same path works for `nest start`,
      // `node dist/main` and Vitest. Production uses real env vars, not a file
      // (a missing file is ignored and validation still runs on process.env).
      envFilePath: [resolve(import.meta.dirname, '../../../.env')],
      validate: validateEnv,
    }),
    // Infrastructure (global providers) first, then feature modules.
    RedisModule,
    PrismaModule,
    HealthModule,
    AirportsModule,
    FlightsModule,
    // Next steps will add: AuthModule, BookingModule ...
  ],
})
export class AppModule {}
