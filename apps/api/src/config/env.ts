import { z } from 'zod';

const DEFAULT_WEB_ORIGIN = 'http://localhost:3000';

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
