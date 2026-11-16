import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { RedisModule } from './redis/redis.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { QueuesModule } from './queues/queues.module.js';
import { HealthModule } from './health/health.module.js';
import { AirportsModule } from './airports/airports.module.js';
import { FlightsModule } from './flights/flights.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { EmailModule } from './email/email.module.js';

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
    QueuesModule,
    HealthModule,
    AirportsModule,
    FlightsModule,
    BookingsModule,
    PaymentsModule,
    EmailModule,
  ],
})
export class AppModule {}
