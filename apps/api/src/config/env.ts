import { CHARGE_CURRENCY, PAYMENT_PROVIDERS } from '@ota/contracts';
import { z } from 'zod';

const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

// An empty `KEY=` line counts as unset.
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || undefined);
const nonNegativeInt = z.coerce.number().int().min(0);
// Percent with at most 2 decimals, as a string (never a float): "2", "2.5", "0".
const percent = z
  .string()
  .trim()
  .regex(/^\d{1,2}(\.\d{1,2})?$/, 'must be a percentage 0–99.99 with at most 2 decimals');
const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

// z.url() accepts any scheme (e.g. http://), so also pin the protocol per service.
// URL.canParse guards new URL(): Zod keeps running refinements even after z.url() fails.
const withProtocol = (...protocols: string[]) =>
  z.url().refine((value) => URL.canParse(value) && protocols.includes(new URL(value).protocol), {
    message: `must use protocol ${protocols.map((p) => `${p}//`).join(' or ')}`,
  });

// Fail fast: if any required env var is missing or malformed, the app refuses to boot.
// Better a crash on deploy than a booking failing at 2 AM because REDIS_URL was empty.
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    WEB_ORIGIN: z.url().optional(),
    DATABASE_URL: withProtocol('postgres:', 'postgresql:'),
    REDIS_URL: withProtocol('redis:', 'rediss:'),
    // Which flight supplier backs /flights. 'mock' needs no credentials (dev, tests, CI).
    SUPPLIER: z.enum(['mock', 'duffel']).default('mock'),
    // An empty `DUFFEL_ACCESS_TOKEN=` line counts as unset.
    DUFFEL_ACCESS_TOKEN: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined),
    // AES-256-GCM key for passenger PII (DOB, passport numbers): base64 of exactly 32 random bytes.
    // Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
    BOOKING_DATA_KEY: z
      .string()
      .trim()
      .refine((v) => /^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, 'base64').length === 32, {
        message: 'must be base64 that decodes to exactly 32 bytes',
      }),
    // Travel insurance provider. Only the clearly-labelled demo provider exists for now.
    INSURANCE_PROVIDER: z.enum(['demo']).default('demo'),
    BRAND_NAME: z.string().trim().min(1).max(40).default('SkyFare'),

    // ---- Pricing (business decisions — config, not code) ----
    // Customers are charged in this currency; only INR is supported (Razorpay India).
    CHARGE_CURRENCY: z.literal(CHARGE_CURRENCY).default(CHARGE_CURRENCY),
    // Markup on the fare: fixed (minor units of CHARGE_CURRENCY, i.e. paise) + percent.
    MARKUP_FIXED_MINOR: nonNegativeInt.default(0),
    MARKUP_PERCENT: percent.default('0'),
    // Stored for the cancellation flow (Step 9); not used yet.
    CANCELLATION_FEE_MINOR: nonNegativeInt.default(0),
    // FX risk buffer on converted amounts (not markup): rate × (1 + buffer%).
    FX_BUFFER_PERCENT: percent.default('2'),
    FX_API_URL: withProtocol('https:', 'http:').default('https://api.frankfurter.dev'),

    // ---- Payments ----
    PAYMENT_PROVIDER: z.enum(PAYMENT_PROVIDERS).default('demo'),
    RAZORPAY_KEY_ID: optionalString,
    RAZORPAY_KEY_SECRET: optionalString,
    RAZORPAY_WEBHOOK_SECRET: optionalString,
    RAZORPAY_API_URL: withProtocol('https:', 'http:').default('https://api.razorpay.com'),

    // ---- Background jobs (BullMQ) ----
    // Run the queue workers inside this process. Production runs a separate worker process.
    WORKERS_ENABLED: bool.default(true),
    // Redis key prefix of every queue (keeps dev, e2e and Playwright jobs apart on one Redis).
    QUEUE_PREFIX: z.string().regex(/^[a-z0-9-]{1,32}$/).default('bull'),

    // ---- Email (SMTP; Mailpit locally, SES SMTP in production) ----
    SMTP_HOST: z.string().trim().min(1).default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_FROM: z.string().trim().min(3).default('SkyFare <bookings@skyfare.test>'),
  })
  .superRefine((env, ctx) => {
    // Messages never echo the value: validation output ends up in deploy logs.
    if (env.SUPPLIER === 'duffel' && !env.DUFFEL_ACCESS_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['DUFFEL_ACCESS_TOKEN'],
        message: 'is required when SUPPLIER=duffel',
      });
    }
    if (env.DUFFEL_ACCESS_TOKEN && !env.DUFFEL_ACCESS_TOKEN.startsWith('duffel_')) {
      ctx.addIssue({
        code: 'custom',
        path: ['DUFFEL_ACCESS_TOKEN'],
        message: 'must start with "duffel_"',
      });
    }
    if (env.PAYMENT_PROVIDER === 'razorpay') {
      for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'is required when PAYMENT_PROVIDER=razorpay' });
      }
    }
    if (env.RAZORPAY_KEY_ID && !/^rzp_(test|live)_/.test(env.RAZORPAY_KEY_ID)) {
      ctx.addIssue({ code: 'custom', path: ['RAZORPAY_KEY_ID'], message: 'must start with "rzp_test_" or "rzp_live_"' });
    }
    // Live money only from a production deploy; a live key on a laptop is a mistake.
    if (env.RAZORPAY_KEY_ID?.startsWith('rzp_live_') && env.NODE_ENV !== 'production') {
      ctx.addIssue({ code: 'custom', path: ['RAZORPAY_KEY_ID'], message: 'live keys are only allowed when NODE_ENV=production' });
    }
    if (env.PAYMENT_PROVIDER === 'fake' && env.NODE_ENV !== 'test') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: '"fake" is only allowed when NODE_ENV=test' });
    }
    if (env.PAYMENT_PROVIDER === 'demo' && env.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: '"demo" is not allowed when NODE_ENV=production' });
    }
    // In production a wrong CORS origin silently breaks the site, so never fall back to localhost.
    if (env.NODE_ENV === 'production' && !env.WEB_ORIGIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'is required when NODE_ENV=production',
      });
    }
  })
  .transform((env) => ({ ...env, WEB_ORIGIN: env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN }));

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    // Print every invalid key at once instead of fixing them one by one
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
