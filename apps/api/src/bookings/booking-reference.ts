import { randomBytes } from 'node:crypto';

// No 0/O/1/I: customers read references aloud and type them from emails. 32 symbols exactly,
// so `byte & 31` picks each one with no modulo bias.
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
// Fixed length = prefix-free: no reference can be the start of another. 32^8 ≈ 1.1e12 values.
export const REFERENCE_LENGTH = 8;
const MAX_ATTEMPTS = 5;

export function generateBookingReference(random: (size: number) => Buffer = randomBytes): string {
  const bytes = random(REFERENCE_LENGTH);
  let ref = '';
  for (let i = 0; i < REFERENCE_LENGTH; i++) ref += REFERENCE_ALPHABET[bytes[i] & 31];
  return ref;
}

/**
 * Runs `create` with fresh references until it doesn't hit the unique constraint (collisions are
 * astronomically rare, but the DB is the source of truth, not probability).
 */
export async function withUniqueReference<T>(
  create: (reference: string) => Promise<T>,
  isUniqueViolation: (err: unknown) => boolean,
  generate: () => string = generateBookingReference,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await create(generate());
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= MAX_ATTEMPTS) throw err;
    }
  }
}
