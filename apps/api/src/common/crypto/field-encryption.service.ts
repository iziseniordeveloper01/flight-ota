import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';

const ALGORITHM = 'aes-256-gcm';
// 96-bit IV is the GCM standard; a fresh random IV per value means equal plaintexts never match.
const IV_BYTES = 12;
// "v1" names the key generation: when the key rotates, v2 values are written and v1 still decrypts.
const VERSION = 'v1';

/**
 * Encrypts individual PII fields (date of birth, passport number) at rest.
 * Format: "v1:<iv b64>:<authTag b64>:<ciphertext b64>". GCM's auth tag makes any tampering (or the
 * wrong key) fail loudly on decrypt instead of returning garbage.
 */
@Injectable()
export class FieldEncryptionService {
  // Private field: keeps the key out of logs, JSON.stringify and Nest's inspectors.
  readonly #key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const key = Buffer.from(config.get('BOOKING_DATA_KEY', { infer: true }), 'base64');
    // env.ts validates this already; re-check so a misconfigured test can't run with a weak key.
    if (key.length !== 32) throw new Error('BOOKING_DATA_KEY must decode to 32 bytes');
    this.#key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, ciphertext] = payload.split(':');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error('Unsupported encrypted value');
    }
    const decipher = createDecipheriv(ALGORITHM, this.#key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    // final() throws "Unsupported state or unable to authenticate data" on tamper / wrong key.
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }
}
