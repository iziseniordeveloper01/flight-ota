import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupplierOffer } from '@ota/contracts';
import { BookingStore, type BookingWithDetails } from '../bookings/booking-store.service.js';
import { displayPriceOf, toMoney } from '../bookings/booking-view.js';
import { withTimeout } from '../common/with-timeout.js';
import type { Env } from '../config/env.js';
import type { EmailJob } from '../queues/queue.constants.js';
import {
  renderBookingConfirmed,
  renderRefundCompleted,
  renderRefundInitiated,
  type EmailBookingData,
  type RefundReasonCode,
  type RenderedEmail,
} from './templates.js';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** nodemailer's Transporter satisfies this; tests capture messages instead. */
export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

const SEND_TIMEOUT_MS = 30_000;

/**
 * Renders and sends booking emails (emails queue; retried with backoff). Jobs carry only ids — the
 * address and names are read from the DB here and never logged.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly store: BookingStore,
    private readonly config: ConfigService<Env, true>,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  async send(job: EmailJob): Promise<string> {
    const booking = await this.store.find(job.bookingId);
    if (!booking) return 'BOOKING_GONE';
    if (!booking.contactEmail) return 'NO_ADDRESS';
    const email = this.render(job, booking);
    if (!email) return 'NOTHING_TO_SEND';

    await withTimeout(
      this.transport.sendMail({ from: this.config.get('SMTP_FROM', { infer: true }), to: booking.contactEmail, ...email }),
      SEND_TIMEOUT_MS,
      'smtp send',
    );
    await this.store.recordEvent(this.store.prisma, booking.id, booking.status, 'SYSTEM', 'Email sent', { kind: job.kind });
    this.logger.log(`Email sent kind=${job.kind} booking=${booking.id}`);
    return 'SENT';
  }

  private render(job: EmailJob, booking: BookingWithDetails): RenderedEmail | null {
    const data = this.data(booking);
    if (job.kind === 'booking-confirmed') return renderBookingConfirmed(data);
    const refund = booking.payments.flatMap((p) => p.refunds).find((r) => r.id === job.refundId);
    if (!refund) return null;
    const amount = toMoney(refund.amount, refund.currency);
    return job.kind === 'refund-initiated'
      ? renderRefundInitiated(data, { amount, reason: refund.reason as RefundReasonCode })
      : renderRefundCompleted(data, { amount });
  }

  private data(b: BookingWithDetails): EmailBookingData {
    const offer = b.offerSnapshot as unknown as SupplierOffer;
    return {
      brand: this.config.get('BRAND_NAME', { infer: true }),
      reference: b.reference,
      pnr: b.pnr,
      demo: b.supplier !== 'tbo',
      contactName: b.contactGivenName ?? '',
      segments: offer.slices.flatMap((slice) =>
        slice.segments.map((s) => ({
          flight: `${s.marketingCarrier.code} ${s.flightNumber}`,
          from: s.origin,
          to: s.destination,
          departureAt: s.departureAt,
          arrivalAt: s.arrivalAt,
        })),
      ),
      passengers: b.passengers.map((p) => [capitalize(p.title), p.givenName, p.familyName].filter(Boolean).join(' ')),
      extras: b.ancillaries.map((a) => a.label),
      total: displayPriceOf(b).total,
    };
  }
}

function capitalize(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
