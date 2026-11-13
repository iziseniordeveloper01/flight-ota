import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';

// Shared by main.ts and the e2e tests so tests exercise the same prefix, headers and CORS as production.
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.use(helmet());

  // Only our own frontend may call this API from a browser.
  app.enableCors({
    origin: config.getOrThrow<string>('WEB_ORIGIN'),
    credentials: true, // needed later for httpOnly auth cookies
  });

  // /v1 prefix: when the API changes in a breaking way we add /v2 without breaking the live site.
  app.setGlobalPrefix('v1');

  // Lets RedisModule (and later Prisma, BullMQ) close connections on Ctrl+C / deploy.
  app.enableShutdownHooks();
}
