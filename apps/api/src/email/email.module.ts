import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { BookingsModule } from '../bookings/bookings.module.js';
import type { Env } from '../config/env.js';
import { QUEUE, QUEUE_SETTINGS, type EmailJob, type QueueSettings } from '../queues/queue.constants.js';
import { startWorker } from '../queues/start-worker.js';
import { EmailService, MAIL_TRANSPORT, type MailTransport } from './email.service.js';

@Processor(QUEUE.emails, { autorun: false, concurrency: 5 })
export class EmailProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly email: EmailService,
    @Inject(QUEUE_SETTINGS) private readonly settings: QueueSettings,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    startWorker(this, this.settings, this.logger);
  }

  process(job: Job<EmailJob>): Promise<string> {
    return this.email.send(job.data);
  }
}

/** SMTP: Mailpit locally (docker-compose), SES SMTP in production. Tests override MAIL_TRANSPORT. */
@Module({
  imports: [BookingsModule],
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MailTransport => {
        const port = config.get('SMTP_PORT', { infer: true });
        const user = config.get('SMTP_USER', { infer: true });
        const pass = config.get('SMTP_PASS', { infer: true });
        return nodemailer.createTransport({
          host: config.get('SMTP_HOST', { infer: true }),
          port,
          secure: port === 465, // 587/1025 upgrade with STARTTLS when offered
          auth: user && pass ? { user, pass } : undefined,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        });
      },
    },
    EmailService,
    EmailProcessor,
  ],
})
export class EmailModule {}
