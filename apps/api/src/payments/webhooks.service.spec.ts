import { summarize } from './webhooks.service.js';

describe('summarize (webhook payload → ids/amount/status only)', () => {
  const payment = {
    id: 'pay_1',
    entity: 'payment',
    order_id: 'order_1',
    amount: 1276760,
    currency: 'INR',
    status: 'captured',
    method: 'card',
    email: 'guest@example.com',
    contact: '+919876543210',
    card: { last4: '1007', name: 'Jane Doe' },
    error_code: null,
  };

  it('payment.captured: order, payment, amount, status — no contact or card data', () => {
    const s = summarize({ entity: 'event', event: 'payment.captured', contains: ['payment'], payload: { payment: { entity: payment } }, created_at: 1 });
    expect(s).toEqual({ type: 'payment.captured', orderId: 'order_1', paymentId: 'pay_1', refundId: null, amountMinor: 1276760n, currency: 'INR', status: 'captured', errorCode: null });
    const json = JSON.stringify(s, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    for (const pii of ['guest@example.com', '+919876543210', 'Jane Doe', '1007']) expect(json).not.toContain(pii);
  });

  it('refund.processed: refund id + its payment, refund amount', () => {
    const s = summarize({
      event: 'refund.processed',
      payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 500, status: 'processed', notes: [] } }, payment: { entity: payment } },
    });
    expect(s).toMatchObject({ type: 'refund.processed', refundId: 'rfnd_1', paymentId: 'pay_1', amountMinor: 500n, status: 'processed' });
  });

  it('payment.failed keeps the error CODE only', () => {
    const s = summarize({ event: 'payment.failed', payload: { payment: { entity: { ...payment, status: 'failed', error_code: 'BAD_REQUEST_ERROR', error_description: 'Card declined for Jane' } } } });
    expect(s).toMatchObject({ status: 'failed', errorCode: 'BAD_REQUEST_ERROR' });
    expect(JSON.stringify(s, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain('Jane');
  });

  it('unknown events are still readable (then ignored); garbage is null', () => {
    expect(summarize({ event: 'payment.downtime.started', payload: {} })).toMatchObject({ type: 'payment.downtime.started', amountMinor: null });
    expect(summarize({ nope: true })).toBeNull();
    expect(summarize('string')).toBeNull();
  });
});
