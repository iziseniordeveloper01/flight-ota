import 'server-only';
import { z } from 'zod';
import { env as publicEnv } from '@/env';

// Server-only configuration (route handlers + server components). Never imported by client code:
// 'server-only' makes such an import a build error, so these values never reach the browser bundle.

const httpUrl = z.url({ protocol: /^https?$/, error: 'Must be an http(s) URL' });

const serverEnvSchema = z.object({
  // How the Next server reaches the API (e.g. a private network address). Defaults to the public URL.
  API_INTERNAL_URL: httpUrl.optional().transform((url) => (url ?? publicEnv.NEXT_PUBLIC_API_URL).replace(/\/+$/, '')),
  // This web app's own origin: mutating /api/bookings calls must come from it (CSRF defence).
  // A wrong value fails closed (403 on every booking action), never open.
  WEB_ORIGIN: httpUrl.default('http://localhost:3000').transform((url) => new URL(url).origin),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const result = serverEnvSchema.safeParse({
  API_INTERNAL_URL: process.env.API_INTERNAL_URL || undefined,
  WEB_ORIGIN: process.env.WEB_ORIGIN || undefined,
  NODE_ENV: process.env.NODE_ENV || undefined,
});

if (!result.success) {
  // Names and reasons only — never echo values.
  const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Invalid server environment: ${details}`);
}

export const serverEnv = result.data;
