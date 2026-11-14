import { generateBookingReference, REFERENCE_ALPHABET, withUniqueReference } from './booking-reference.js';

describe('booking reference', () => {
  it('8 chars from the unambiguous alphabet', () => {
    expect(REFERENCE_ALPHABET).toHaveLength(32);
    expect(REFERENCE_ALPHABET).not.toMatch(/[01OI]/);
    for (let i = 0; i < 500; i++) expect(generateBookingReference()).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
  });

  it('maps every byte value uniformly onto the alphabet', () => {
    const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const counts = new Map<string, number>();
    for (let offset = 0; offset < 256; offset += 8) {
      for (const ch of generateBookingReference(() => all.subarray(offset, offset + 8))) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(32);
    expect(new Set(counts.values())).toEqual(new Set([8]));
  });

  it('retries on a unique violation with a new reference', async () => {
    const refs = ['AAAAAAAA', 'BBBBBBBB'];
    const create = vi.fn(async (ref: string) => {
      if (ref === 'AAAAAAAA') throw new Error('unique');
      return ref;
    });
    const result = await withUniqueReference(create, (e) => (e as Error).message === 'unique', () => refs.shift()!);
    expect(result).toBe('BBBBBBBB');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('gives up after 5 collisions and rethrows other errors immediately', async () => {
    const always = vi.fn(async () => {
      throw new Error('unique');
    });
    await expect(withUniqueReference(always, () => true)).rejects.toThrow('unique');
    expect(always).toHaveBeenCalledTimes(5);

    const other = vi.fn(async () => {
      throw new Error('db down');
    });
    await expect(withUniqueReference(other, (e) => (e as Error).message === 'unique')).rejects.toThrow('db down');
    expect(other).toHaveBeenCalledTimes(1);
  });
});
