import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentProviderName } from '@ota/contracts';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** Everything a provider call can fail with. Messages carry provider codes only — never PII. */
export type PaymentErrorCode = 'TIMEOUT' | 'UNAVAILABLE' | 'BAD_REQUEST' | 'NOT_FOUND' | 'UPSTREAM_ERROR';

export class PaymentProviderError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export interface CallOpts {
  timeoutMs?: number;
}

export interface CreateOrderInput {
  amountMinor: bigint;
  currency: string;
  /** ≤ 40 chars, unique per order. */
  receipt: string;
  /** Ids only — never PII. */
  notes: Record<string, string>;
}

export interface ProviderOrder {
  id: string;
  amountMinor: bigint;
  currency: string;
}

export type ProviderPaymentStatus = 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';

export interface ProviderPayment {
  id: string;
  orderId: string | null;
  amountMinor: bigint;
  currency: string;
  status: ProviderPaymentStatus;
  method: string | null;
  errorCode: string | null;
  /** Machine reason (e.g. "payment_failed"); never the free-text description. */
  errorReason: string | null;
}

export type ProviderRefundStatus = 'pending' | 'processed' | 'failed';

export interface ProviderRefund {
  id: string;
  paymentId: string;
  amountMinor: bigint;
  status: ProviderRefundStatus;
}

export interface RefundInput {
  amountMinor: bigint;
  /** Our refund id: the provider de-duplicates retries with it. */
  idempotencyKey: string;
  notes: Record<string, string>;
}

/**
 * A payment gateway. Amounts are minor units (paise). Every call has a timeout and maps all
 * failures to PaymentProviderError.
 */
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /** Public key id handed to the browser checkout. */
  readonly keyId: string;
  createOrder(input: CreateOrderInput, opts?: CallOpts): Promise<ProviderOrder>;
  fetchPayment(paymentId: string, opts?: CallOpts): Promise<ProviderPayment>;
  fetchOrderPayments(orderId: string, opts?: CallOpts): Promise<ProviderPayment[]>;
  capture(paymentId: string, amountMinor: bigint, currency: string, opts?: CallOpts): Promise<ProviderPayment>;
  refund(paymentId: string, input: RefundInput, opts?: CallOpts): Promise<ProviderRefund>;
  fetchRefund(refundId: string, opts?: CallOpts): Promise<ProviderRefund>;
  /** Checkout success handler: HMAC over OUR stored order id + the payment id. */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;
  /** Webhook: HMAC over the RAW request body. */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}

/** HMAC-SHA256 hex — Razorpay's scheme for both checkout and webhook signatures. */
export function hmacHex(secret: string, message: string | Buffer): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

/** Constant-time comparison of two hex digests; false for anything malformed. */
export function hexDigestEquals(expectedHex: string, presented: string | undefined): boolean {
  if (!presented || !/^[a-f0-9]{64}$/.test(presented)) return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(presented, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** PAYMENT_PROVIDER=demo: no gateway at all (confirm-demo books without money). Never called. */
export class DemoPaymentProvider implements PaymentProvider {
  readonly name = 'demo' as const;
  readonly keyId = '';
  private unsupported(): never {
    throw new PaymentProviderError('BAD_REQUEST', 'Payments are disabled (PAYMENT_PROVIDER=demo)');
  }
  createOrder(): Promise<ProviderOrder> {
    this.unsupported();
  }
  fetchPayment(): Promise<ProviderPayment> {
    this.unsupported();
  }
  fetchOrderPayments(): Promise<ProviderPayment[]> {
    this.unsupported();
  }
  capture(): Promise<ProviderPayment> {
    this.unsupported();
  }
  refund(): Promise<ProviderRefund> {
    this.unsupported();
  }
  fetchRefund(): Promise<ProviderRefund> {
    this.unsupported();
  }
  verifyCheckoutSignature(): boolean {
    return false;
  }
  verifyWebhookSignature(): boolean {
    return false;
  }
}
