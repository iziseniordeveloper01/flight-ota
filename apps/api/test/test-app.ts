import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@ota/db';
import type { SupplierAdapter } from '@ota/suppliers';
import type { Redis } from 'ioredis';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { MAIL_TRANSPORT, type MailMessage, type MailTransport } from './../src/email/email.service.js';
import { SUPPLIER_ADAPTER } from './../src/flights/supplier.provider.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './../src/payments/payment-provider.js';
import { FX_RATE_SOURCE, type FxRateSource } from './../src/pricing/fx-rate-source.js';
import { QUEUE_SETTINGS, type QueueSettings } from './../src/queues/queue.constants.js';
import { REDIS_CLIENT } from './../src/redis/redis.module.js';

/** Offline FX: fixed rates, can be switched "down". Its own source name keeps its cache/DB rows apart. */
export class FixedRateSource implements FxRateSource {
  down = false;
  calls = 0;
  constructor(
    /** Distinct per suite when a test depends on an empty cache / no stored rates. */
    readonly name = 'test-fixed',
    readonly rates: Record<string, string> = { USD: '83.5', EUR: '90.25', GBP: '105.4' },
  ) {}

  async fetchRate(base: string): Promise<string> {
    this.calls++;
    if (this.down || !this.rates[base]) throw new Error('FX source down');
    return this.rates[base];
  }
}

/** Captures emails instead of sending them. */
export class CapturingTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  async sendMail(message: MailMessage): Promise<unknown> {
    this.sent.push(message);
    return { messageId: `test-${this.sent.length}` };
  }
}

export interface TestAppOptions {
  supplier: SupplierAdapter;
  fx?: FxRateSource;
  payment?: PaymentProvider;
  mail?: MailTransport;
  /** Run the BullMQ workers in-process, on a queue prefix of their own (no other test app sees the jobs). */
  workers?: boolean;
}

/** AppModule with every external dependency replaced (supplier, FX, payments, SMTP, queue prefix). */
export async function createTestApp(opts: TestAppOptions): Promise<INestApplication<App>> {
  const settings: QueueSettings = opts.workers
    ? { prefix: `e2e-${randomBytes(4).toString('hex')}`, workersEnabled: true }
    : { prefix: 'e2e', workersEnabled: false };
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SUPPLIER_ADAPTER)
    .useValue(opts.supplier)
    .overrideProvider(FX_RATE_SOURCE)
    .useValue(opts.fx ?? new FixedRateSource())
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(opts.mail ?? new CapturingTransport())
    .overrideProvider(QUEUE_SETTINGS)
    .useValue(settings);
  if (opts.payment) builder = builder.overrideProvider(PAYMENT_PROVIDER).useValue(opts.payment);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ rawBody: true });
  configureApp(app);
  await app.init();
  const redis = app.get<Redis>(REDIS_CLIENT);
  if (redis.status !== 'ready') await new Promise<void>((resolve) => redis.once('ready', () => resolve()));
  return app;
}

/** Delete this suite's Redis keys by pattern — never FLUSHALL. */
export async function deleteKeys(redis: Redis, pattern: string): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    if (keys.length) await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
}

/** Payments are Restrict-linked (money records are never cascaded away): delete them first. */
export async function deleteBookings(prisma: PrismaClient, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await prisma.refund.deleteMany({ where: { payment: { bookingId: { in: ids } } } });
  await prisma.payment.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

/** Poll until `check` returns a value (or time out). */
export async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 15_000, label = 'condition'): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
