import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrismaClient, type PrismaClient } from '@ota/db';
import { withTimeout } from '../common/with-timeout.js';

export const PRISMA = Symbol('PRISMA');

// Same pattern as RedisModule: one global client, injected by token, closed on shutdown.
@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<PrismaClient> => {
        const logger = new Logger('Prisma');
        const prisma = createPrismaClient({ connectionString: config.getOrThrow<string>('DATABASE_URL') });
        try {
          await withTimeout(prisma.$connect(), 5_000, 'database connect');
          logger.log('Connected');
        } catch (err) {
          // Don't crash the boot: /v1/health will report "database: down" so the
          // load balancer keeps this instance out until the DB is reachable.
          logger.error(`Initial connection failed: ${(err as Error).message}`);
        }
        return prisma;
      },
    },
  ],
  exports: [PRISMA],
})
export class PrismaModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}