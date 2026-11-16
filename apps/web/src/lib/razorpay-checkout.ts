import type { PaymentOrder, PaymentVerifyBody } from '@ota/contracts';

// Razorpay Standard Checkout (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/).
// Loaded lazily, only on the review page, and only when the customer presses "Pay".
export const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const LOAD_TIMEOUT_MS = 15_000;

export interface CheckoutCallbacks {
  /** Success: the signed response, verified by our server (never trusted on its own). */
  onSuccess: (response: PaymentVerifyBody) => void;
  /** A payment attempt failed (card declined, UPI failure …). */
  onFailure: () => void;
  /** The customer closed the checkout without paying. */
  onDismiss: () => void;
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: (response: unknown) => void): void;
}
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let loading: Promise<RazorpayConstructor> | null = null;

/** Inject checkout.js once; a failed load can be retried. */
export function loadCheckout(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  loading ??= new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    const timer = setTimeout(() => fail(new Error('Checkout script timed out')), LOAD_TIMEOUT_MS);
    const fail = (err: Error) => {
      clearTimeout(timer);
      script.remove();
      loading = null;
      reject(err);
    };
    script.onload = () => {
      clearTimeout(timer);
      if (window.Razorpay) resolve(window.Razorpay);
      else fail(new Error('Checkout script loaded without Razorpay'));
    };
    script.onerror = () => fail(new Error('Checkout script failed to load'));
    document.head.appendChild(script);
  });
  return loading;
}

/** Open the checkout for one provider order. Exactly one callback fires per order. */
export async function openCheckout(order: PaymentOrder, callbacks: CheckoutCallbacks): Promise<void> {
  const Razorpay = await loadCheckout();
  let settled = false;
  const once = (fn: () => void) => {
    if (settled) return;
    settled = true;
    fn();
  };
  const checkout = new Razorpay({
    key: order.keyId,
    order_id: order.orderId,
    amount: order.amountMinor,
    currency: order.currency,
    name: order.name,
    description: order.description,
    prefill: order.prefill,
    // Closes before the offer expires; "Try again" always creates a NEW order (our retry, not Razorpay's).
    timeout: order.timeoutSeconds,
    retry: { enabled: false },
    handler: (response: PaymentVerifyBody) =>
      once(() =>
        callbacks.onSuccess({
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_signature: response.razorpay_signature,
        }),
      ),
    modal: { ondismiss: () => once(callbacks.onDismiss), confirm_close: true },
  });
  checkout.on('payment.failed', () => once(callbacks.onFailure));
  checkout.open();
}
