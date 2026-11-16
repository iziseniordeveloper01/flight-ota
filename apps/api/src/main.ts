import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap(): Promise<void> {
  // rawBody: webhook signatures are verified over the exact bytes received (req.rawBody).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);

  const port = app.get(ConfigService).getOrThrow<number>('PORT');
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on port ${port} (prefix /v1)`);
}

void bootstrap();
