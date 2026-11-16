import { z } from 'zod';
import { normalizeRate } from './pricing.js';

export const FX_RATE_SOURCE = Symbol('FX_RATE_SOURCE');

/** Where live exchange rates come from. Tests override the FX_RATE_SOURCE token (no network). */
export interface FxRateSource {
  readonly name: string;
  /** Latest base→quote rate as a decimal string (≤ 8 decimals). Throws on any failure. */
  fetchRate(base: string, quote: string, opts: { signal: AbortSignal }): Promise<string>;
}

// GET /v2/rate/{base}/{quote} → {"date":"2026-11-16","base":"USD","quote":"INR","rate":94.11}
const rateResponse = z.object({ base: z.string(), quote: z.string(), rate: z.number().positive(), date: z.string() });

/** Frankfurter v2 (https://frankfurter.dev): free, no key, rates blended across central banks. */
export class FrankfurterRateSource implements FxRateSource {
  readonly name = 'frankfurter';

  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async fetchRate(base: string, quote: string, opts: { signal: AbortSignal }): Promise<string> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v2/rate/${encodeURIComponent(base)}/${encodeURIComponent(quote)}`;
    const res = await this.fetchFn(url, { headers: { Accept: 'application/json' }, signal: opts.signal });
    if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
    const body = rateResponse.parse(await res.json());
    if (body.base !== base || body.quote !== quote) throw new Error('Frankfurter returned another currency pair');
    return normalizeRate(body.rate);
  }
}
