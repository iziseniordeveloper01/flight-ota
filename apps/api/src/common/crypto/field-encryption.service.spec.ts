import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { FieldEncryptionService } from './field-encryption.service.js';

const serviceWith = (key: Buffer) =>
  new FieldEncryptionService({ get: () => key.toString('base64') } as unknown as ConfigService<Env, true>);

describe('FieldEncryptionService', () => {
  const key = randomBytes(32);
  const crypto = serviceWith(key);

  it('round-trips and uses the v1:iv:tag:ciphertext format', () => {
    const encrypted = crypto.encrypt('X1234567');
    expect(encrypted).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(encrypted).not.toContain('X1234567');
    expect(crypto.decrypt(encrypted)).toBe('X1234567');
    expect(crypto.decrypt(crypto.encrypt(''))).toBe('');
  });

  it('uses a different IV each time (equal plaintexts never produce equal ciphertexts)', () => {
    const a = crypto.encrypt('1990-01-01');
    const b = crypto.encrypt('1990-01-01');
    expect(a).not.toBe(b);
    expect(a.split(':')[1]).not.toBe(b.split(':')[1]);
  });

  it('detects tampering with the ciphertext or the auth tag', () => {
    const [v, iv, tag, ct] = crypto.encrypt('X1234567').split(':');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 0x01;
    expect(() => crypto.decrypt([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow();
    const badTag = Buffer.from(tag, 'base64');
    badTag[0] ^= 0x01;
    expect(() => crypto.decrypt([v, iv, badTag.toString('base64'), ct].join(':'))).toThrow();
  });

  it('fails with the wrong key', () => {
    const encrypted = crypto.encrypt('X1234567');
    expect(() => serviceWith(randomBytes(32)).decrypt(encrypted)).toThrow();
  });

  it('rejects unknown versions and keys that are not 32 bytes', () => {
    expect(() => crypto.decrypt('v2:a:b:c')).toThrow(/Unsupported/);
    expect(() => serviceWith(randomBytes(16))).toThrow(/32 bytes/);
  });
});
