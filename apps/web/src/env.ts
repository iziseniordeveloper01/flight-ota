import { z } from 'zod';

const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z
    .url({ protocol: /^https?$/, error: 'Must be an http(s) URL' })
    .default('http://localhost:4000/v1')
    // Normalise so callers can always do `${API_URL}/path`.
    .transform((url) => url.replace(/\/+$/, '')),
  NEXT_PUBLIC_BRAND_NAME: z.string().trim().min(1).max(40).default('SkyFare'),
});

// Next inlines NEXT_PUBLIC_* only for literal `process.env.NAME` accesses, so each is listed
// explicitly. Empty strings count as "not set" so the defaults apply.
const result = publicEnvSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || undefined,
  NEXT_PUBLIC_BRAND_NAME: process.env.NEXT_PUBLIC_BRAND_NAME || undefined,
});

if (!result.success) {
  // Names and reasons only — never echo values.
  const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Invalid public environment: ${details}`);
}

export const env = result.data;
