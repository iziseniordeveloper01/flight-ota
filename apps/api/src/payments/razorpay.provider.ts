import { z } from 'zod';
import {
  hexDigestEquals,
  hmacHex,
  PaymentProviderError,
  type CallOpts,
  type CreateOrderInput,
  type PaymentProvider,
  type ProviderOrder,
  type ProviderPayment,
  type ProviderRefund,
  type RefundInput,
} from './payment-provider.js';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** https://api.razorpay.com */
  baseUrl: string;
}

// Only the fields we use; amounts are integers in paise. Payment entities also carry email/contact
// — they are never read, logged or stored.
const minor = z.number().int().nonnegative().transform((n) => BigInt(n));
const orderSchema = z.object({ id: z.string(), amount: minor, currency: z.string() });
const paymentSchema = z.object({
  id: z.string(),
  order_id: z.string().nullish(),
  amount: minor,
  currency: z.string(),
  status: z.enum(['created', 'authorized', 'captured', 'refunded', 'failed']),
  method: z.string().nullish(),
  error_code: z.string().nullish(),
  error_reason: z.string().nullish(),
});
const refundSchema = z.object({
  id: z.string(),
  payment_id: z.string(),
  amount: minor,
  status: z.enum(['pending', 'processed', 'failed']),
});
const errorSchema = z.object({ error: z.object({ code: z.string().optional(), reason: z.string().nullish() }).optional() });

/**
 * Razorpay over native fetch with Basic auth (key id : key secret) — like the Duffel adapter. The
 * official SDK is not used: it can't take a timeout/AbortSignal per request, drops the
 * X-Refund-Idempotency header and crashes on network errors.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;
  private readonly auth: string;

  constructor(
    private readonly config: RazorpayConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.auth = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;
  }

  get keyId(): string {
    return this.config.keyId;
  }

  async createOrder(input: CreateOrderInput, opts?: CallOpts): Promise<ProviderOrder> {
    const body = { amount: toNumber(input.amountMinor), currency: input.currency, receipt: input.receipt, notes: input.notes };
    const order = parse(orderSchema, await this.call('POST', '/v1/orders', opts, body));
    return { id: order.id, amountMinor: order.amount, currency: order.currency };
  }

  async fetchPayment(paymentId: string, opts?: CallOpts): Promise<ProviderPayment> {
    return toPayment(parse(paymentSchema, await this.call('GET', `/v1/payments/${encodeURIComponent(paymentId)}`, opts)));
  }

  async fetchOrderPayments(orderId: string, opts?: CallOpts): Promise<ProviderPayment[]> {
    const res = parse(z.object({ items: z.array(paymentSchema) }), await this.call('GET', `/v1/orders/${encodeURIComponent(orderId)}/payments`, opts));
    return res.items.map(toPayment);
  }

  async capture(paymentId: string, amountMinor: bigint, currency: string, opts?: CallOpts): Promise<ProviderPayment> {
    const body = { amount: toNumber(amountMinor), currency };
    return toPayment(parse(paymentSchema, await this.call('POST', `/v1/payments/${encodeURIComponent(paymentId)}/capture`, opts, body)));
  }

  async refund(paymentId: string, input: RefundInput, opts?: CallOpts): Promise<ProviderRefund> {
    // Omitting `amount` would also refund in full; we send it so a partial capture can't surprise us.
    // X-Refund-Idempotency + receipt: a retried request returns the same refund, never a second one.
    const body = { amount: toNumber(input.amountMinor), speed: 'normal', receipt: input.idempotencyKey, notes: input.notes };
    const refund = parse(refundSchema, 
      await this.call('POST', `/v1/payments/${encodeURIComponent(paymentId)}/refund`, opts, body, { 'X-Refund-Idempotency': input.idempotencyKey }),
    );
    return toRefund(refund);
  }

  async fetchRefund(refundId: string, opts?: CallOpts): Promise<ProviderRefund> {
    return toRefund(parse(refundSchema, await this.call('GET', `/v1/refunds/${encodeURIComponent(refundId)}`, opts)));
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    return hexDigestEquals(hmacHex(this.config.keySecret, `${orderId}|${paymentId}`), signature);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    return hexDigestEquals(hmacHex(this.config.webhookSecret, rawBody), signature);
  }

  private async call(method: 'GET' | 'POST', path: string, opts: CallOpts = {}, body?: unknown, headers: Record<string, string> = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: { Authorization: this.auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError') throw new PaymentProviderError('TIMEOUT', `Razorpay ${method} timed out`);
      throw new PaymentProviderError('UNAVAILABLE', `Razorpay ${method} network error`);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // Non-JSON body (proxy error page …): handled by the status below.
    }
    if (res.ok) return json;
    const parsed = errorSchema.safeParse(json);
    const code = parsed.success ? (parsed.data.error?.code ?? 'UNKNOWN') : 'UNKNOWN';
    const reason = parsed.success ? (parsed.data.error?.reason ?? '') : '';
    const detail = `Razorpay ${method} HTTP ${res.status} ${code}${reason ? ` (${reason})` : ''}`;
    if (res.status === 404) throw new PaymentProviderError('NOT_FOUND', detail);
    if (res.status >= 500 || res.status === 429) throw new PaymentProviderError('UNAVAILABLE', detail);
    if (res.status === 400) throw new PaymentProviderError('BAD_REQUEST', detail);
    throw new PaymentProviderError('UPSTREAM_ERROR', detail);
  }
}

// A response we can't read is a provider failure like any other (nothing else escapes the provider).
function parse<S extends z.ZodType>(schema: S, json: unknown): z.output<S> {
  const result = schema.safeParse(json);
  if (!result.success) throw new PaymentProviderError('UPSTREAM_ERROR', 'Razorpay returned an unexpected response');
  return result.data;
}

function toNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount too large');
  return Number(value);
}

function toPayment(p: z.output<typeof paymentSchema>): ProviderPayment {
  return {
    id: p.id,
    orderId: p.order_id ?? null,
    amountMinor: p.amount,
    currency: p.currency,
    status: p.status,
    method: p.method ?? null,
    errorCode: p.error_code ?? null,
    errorReason: p.error_reason ?? null,
  };
}

function toRefund(r: z.output<typeof refundSchema>): ProviderRefund {
  return { id: r.id, paymentId: r.payment_id, amountMinor: r.amount, status: r.status };
}
