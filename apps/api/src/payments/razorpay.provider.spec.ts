import { createHmac } from 'node:crypto';
import { hexDigestEquals, PaymentProviderError } from './payment-provider.js';
import { RazorpayProvider } from './razorpay.provider.js';

const config = { keyId: 'rzp_test_abc', keySecret: 'key_secret_x', webhookSecret: 'whsec_y', baseUrl: 'https://api.razorpay.test' };
const hmac = (secret: string, msg: string | Buffer) => createHmac('sha256', secret).update(msg).digest('hex');

function provider(responses: Array<{ status: number; body: unknown }> | ((url: string, init: RequestInit) => Promise<Response>)) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue = Array.isArray(responses) ? [...responses] : null;
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (!queue) return (responses as (u: string, i: RequestInit) => Promise<Response>)(url, init);
    const next = queue.shift()!;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { rzp: new RazorpayProvider(config, fetchFn), calls };
}

describe('Razorpay signatures', () => {
  const { rzp } = provider([]);

  it('checkout: HMAC-SHA256(order_id|payment_id, key secret) — tampering fails', () => {
    const sig = hmac(config.keySecret, 'order_1|pay_1');
    expect(rzp.verifyCheckoutSignature('order_1', 'pay_1', sig)).toBe(true);
    expect(rzp.verifyCheckoutSignature('order_2', 'pay_1', sig)).toBe(false); // another order id
    expect(rzp.verifyCheckoutSignature('order_1', 'pay_2', sig)).toBe(false);
    expect(rzp.verifyCheckoutSignature('order_1', 'pay_1', sig.replace(/.$/, (c) => (c === '0' ? '1' : '0')))).toBe(false);
    expect(rzp.verifyCheckoutSignature('order_1', 'pay_1', hmac('other_secret', 'order_1|pay_1'))).toBe(false);
  });

  it('webhook: HMAC over the RAW bytes — any change (even whitespace) fails', () => {
    const raw = Buffer.from('{"event":"payment.captured","payload":{}}');
    const sig = hmac(config.webhookSecret, raw);
    expect(rzp.verifyWebhookSignature(raw, sig)).toBe(true);
    expect(rzp.verifyWebhookSignature(Buffer.from('{"event": "payment.captured","payload":{}}'), sig)).toBe(false);
    expect(rzp.verifyWebhookSignature(raw, hmac(config.keySecret, raw))).toBe(false); // key secret ≠ webhook secret
  });

  it('malformed signatures are rejected without throwing', () => {
    expect(hexDigestEquals(hmac('s', 'm'), undefined)).toBe(false);
    expect(hexDigestEquals(hmac('s', 'm'), 'not-hex')).toBe(false);
    expect(hexDigestEquals(hmac('s', 'm'), 'ab')).toBe(false);
    expect(hexDigestEquals(hmac('s', 'm'), hmac('s', 'm').toUpperCase())).toBe(false);
  });
});

describe('RazorpayProvider HTTP', () => {
  it('createOrder: Basic auth, paise as integer, receipt + notes', async () => {
    const { rzp, calls } = provider([{ status: 200, body: { id: 'order_X', amount: 1276760, currency: 'INR', status: 'created' } }]);
    const order = await rzp.createOrder({ amountMinor: 1276760n, currency: 'INR', receipt: 'K7MX2QPA-1', notes: { bookingId: 'b1', reference: 'K7MX2QPA' } });
    expect(order).toEqual({ id: 'order_X', amountMinor: 1276760n, currency: 'INR' });
    expect(calls[0].url).toBe('https://api.razorpay.test/v1/orders');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('rzp_test_abc:key_secret_x').toString('base64')}`);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ amount: 1276760, currency: 'INR', receipt: 'K7MX2QPA-1', notes: { bookingId: 'b1', reference: 'K7MX2QPA' } });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refund: sends X-Refund-Idempotency and the amount; maps the refund', async () => {
    const { rzp, calls } = provider([{ status: 200, body: { id: 'rfnd_1', payment_id: 'pay_1', amount: 500, status: 'pending' } }]);
    const refund = await rzp.refund('pay_1', { amountMinor: 500n, idempotencyKey: 'refund-uuid-123', notes: { refundId: 'refund-uuid-123' } });
    expect(refund).toEqual({ id: 'rfnd_1', paymentId: 'pay_1', amountMinor: 500n, status: 'pending' });
    expect(calls[0].url).toBe('https://api.razorpay.test/v1/payments/pay_1/refund');
    expect((calls[0].init.headers as Record<string, string>)['X-Refund-Idempotency']).toBe('refund-uuid-123');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ amount: 500, speed: 'normal', receipt: 'refund-uuid-123' });
  });

  it('fetchPayment reads ids/amount/status only (contact data is ignored)', async () => {
    const { rzp } = provider([
      { status: 200, body: { id: 'pay_1', order_id: 'order_1', amount: 100, currency: 'INR', status: 'captured', method: 'upi', email: 'x@y.z', contact: '+91999' } },
    ]);
    const p = await rzp.fetchPayment('pay_1');
    expect(p).toEqual({ id: 'pay_1', orderId: 'order_1', amountMinor: 100n, currency: 'INR', status: 'captured', method: 'upi', errorCode: null, errorReason: null });
    expect(JSON.stringify(p, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain('x@y.z');
  });

  it.each([
    [400, 'BAD_REQUEST'],
    [401, 'UPSTREAM_ERROR'],
    [404, 'NOT_FOUND'],
    [429, 'UNAVAILABLE'],
    [502, 'UNAVAILABLE'],
  ])('HTTP %i → %s (message has the provider code, never secrets)', async (status, code) => {
    const { rzp } = provider([{ status, body: { error: { code: 'BAD_REQUEST_ERROR', description: 'x', reason: 'input_validation_failed' } } }]);
    const err = await rzp.fetchPayment('pay_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect((err as PaymentProviderError).code).toBe(code);
    expect((err as Error).message).not.toContain(config.keySecret);
  });

  it('timeouts and network errors are PaymentProviderError too; unexpected bodies as well', async () => {
    const timeout = provider(async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    });
    await expect(timeout.rzp.fetchPayment('pay_1')).rejects.toMatchObject({ code: 'TIMEOUT' });
    const network = provider(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(network.rzp.fetchPayment('pay_1')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const weird = provider([{ status: 200, body: { unexpected: true } }]);
    await expect(weird.rzp.fetchPayment('pay_1')).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
});
