// BullMQ queue names and job payloads. Payloads carry ids only — never PII (Redis is not encrypted
// at rest and job data shows up in dashboards). Workers load everything else from the DB.

export const QUEUE = {
  ticketing: 'ticketing',
  paymentsWebhooks: 'payments-webhooks',
  refunds: 'refunds',
  emails: 'emails',
  maintenance: 'maintenance',
} as const;

export const QUEUE_SETTINGS = Symbol('QUEUE_SETTINGS');

export interface QueueSettings {
  /** Redis key prefix (separates dev, e2e and Playwright queues on one Redis). */
  prefix: string;
  /** Start the workers in this process. */
  workersEnabled: boolean;
}

export type EmailKind = 'booking-confirmed' | 'refund-initiated' | 'refund-completed';

export interface TicketJob {
  bookingId: string;
}
export interface RecoverJob {
  bookingId: string;
  /** 1-based attempt; schedules the next one while the outcome is still unknown. */
  attempt: number;
}
export interface WebhookJob {
  eventId: string;
}
export interface RefundBookingJob {
  bookingId: string;
}
export interface RefundSendJob {
  refundId: string;
}
export interface EmailJob {
  kind: EmailKind;
  bookingId: string;
  refundId?: string;
}
