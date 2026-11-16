import { randomBytes } from 'node:crypto';
import {
  hexDigestEquals,
  hmacHex,
  PaymentProviderError,
  type CreateOrderInput,
  type PaymentProvider,
  type ProviderOrder,
  type ProviderPayment,
  type ProviderRefund,
  type ProviderPaymentStatus,
  type RefundInput,
} from './payment-provider.js';

export const FAKE_KEY_ID = 'rzp_test_fake';
export const FAKE_KEY_SECRET = 'fake_key_secret';
export const FAKE_WEBHOOK_SECRET = 'fake_webhook_secret';

const id = (prefix: string) => `${prefix}_fake${randomBytes(6).toString('hex')}`;

/**
 * In-memory Razorpay double (PAYMENT_PROVIDER=fake, NODE_ENV=test only): same signature scheme,
 * no network. A payment id `pay_<x>` for an order `order_<x>` that was never "paid" through the
 * helpers counts as captured for the full order amount — this is what the mocked checkout script
 * in Playwright produces (it can only sign, not call the API process).
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  readonly keyId = FAKE_KEY_ID;
  readonly orders = new Map<string, ProviderOrder & { receipt: string; notes: Record<string, string> }>();
  readonly payments = new Map<string, ProviderPayment>();
  readonly refunds = new Map<string, ProviderRefund & { idempotencyKey: string }>();

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    const order = { id: id('order'), amountMinor: input.amountMinor, currency: input.currency, receipt: input.receipt, notes: input.notes };
    this.orders.set(order.id, order);
    return { id: order.id, amountMinor: order.amountMinor, currency: order.currency };
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    const known = this.payments.get(paymentId);
    if (known) return known;
    const order = this.orders.get(`order_${paymentId.replace(/^pay_/, '')}`);
    if (!order) throw new PaymentProviderError('NOT_FOUND', 'Fake: unknown payment');
    return this.record(paymentId, order.id, 'captured', order.amountMinor, order.currency);
  }

  async fetchOrderPayments(orderId: string): Promise<ProviderPayment[]> {
    return [...this.payments.values()].filter((p) => p.orderId === orderId);
  }

  async capture(paymentId: string, amountMinor: bigint): Promise<ProviderPayment> {
    const p = await this.fetchPayment(paymentId);
    if (p.status !== 'authorized' || p.amountMinor !== amountMinor) throw new PaymentProviderError('BAD_REQUEST', 'Fake: cannot capture');
    return this.record(p.id, p.orderId!, 'captured', p.amountMinor, p.currency, p.method);
  }

  async refund(paymentId: string, input: RefundInput): Promise<ProviderRefund> {
    const existing = [...this.refunds.values()].find((r) => r.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    const refund = { id: id('rfnd'), paymentId, amountMinor: input.amountMinor, status: 'pending' as const, idempotencyKey: input.idempotencyKey };
    this.refunds.set(refund.id, refund);
    return refund;
  }

  async fetchRefund(refundId: string): Promise<ProviderRefund> {
    const refund = this.refunds.get(refundId);
    if (!refund) throw new PaymentProviderError('NOT_FOUND', 'Fake: unknown refund');
    return refund;
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    return hexDigestEquals(hmacHex(FAKE_KEY_SECRET, `${orderId}|${paymentId}`), signature);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    return hexDigestEquals(hmacHex(FAKE_WEBHOOK_SECRET, rawBody), signature);
  }

  // ---- test helpers ----

  /** The customer pays in the checkout: returns what Checkout's success handler would receive. */
  pay(orderId: string, opts: { status?: ProviderPaymentStatus; amountMinor?: bigint; method?: string } = {}) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error('Fake: unknown order');
    const paymentId = id('pay');
    this.record(paymentId, orderId, opts.status ?? 'captured', opts.amountMinor ?? order.amountMinor, order.currency, opts.method ?? 'card');
    return { razorpay_payment_id: paymentId, razorpay_order_id: orderId, razorpay_signature: hmacHex(FAKE_KEY_SECRET, `${orderId}|${paymentId}`) };
  }

  setRefundStatus(refundId: string, status: ProviderRefund['status']): void {
    const refund = this.refunds.get(refundId);
    if (!refund) throw new Error('Fake: unknown refund');
    this.refunds.set(refundId, { ...refund, status });
  }

  signWebhook(rawBody: string): string {
    return hmacHex(FAKE_WEBHOOK_SECRET, rawBody);
  }

  private record(paymentId: string, orderId: string, status: ProviderPaymentStatus, amountMinor: bigint, currency: string, method: string | null = 'card'): ProviderPayment {
    const payment: ProviderPayment = {
      id: paymentId,
      orderId,
      amountMinor,
      currency,
      status,
      method,
      errorCode: status === 'failed' ? 'BAD_REQUEST_ERROR' : null,
      errorReason: status === 'failed' ? 'payment_failed' : null,
    };
    this.payments.set(paymentId, payment);
    return payment;
  }
}
