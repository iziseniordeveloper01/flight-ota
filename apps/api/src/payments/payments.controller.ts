import {
  BadRequestException,
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { paymentVerifySchema, type PaymentOrderResponse, type PaymentVerifyBody, type PaymentVerifyResponse } from '@ota/contracts';
import type { Request } from 'express';
import { BookingIdPipe } from '../bookings/booking-id.pipe.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.js';
import { PaymentsService } from './payments.service.js';
import { summarize, WebhooksService } from './webhooks.service.js';

const NO_STORE = ['Cache-Control', 'no-store'] as const;
const TOKEN_HEADER = 'x-booking-token';

/** Guest payment endpoints (same X-Booking-Token rules as the rest of /bookings). */
@Controller('bookings')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/payment-order')
  @HttpCode(201)
  @Header(...NO_STORE)
  async createOrder(@Param('id', BookingIdPipe) id: string, @Headers(TOKEN_HEADER) token?: string): Promise<PaymentOrderResponse> {
    return { data: await this.payments.createOrder(id, token) };
  }

  /** 202: the money is in; ticketing continues in the background (poll GET /bookings/:id). */
  @Post(':id/payment-verify')
  @HttpCode(202)
  @Header(...NO_STORE)
  async verify(
    @Param('id', BookingIdPipe) id: string,
    @Body(new ZodValidationPipe(paymentVerifySchema)) body: PaymentVerifyBody,
    @Headers(TOKEN_HEADER) token?: string,
  ): Promise<PaymentVerifyResponse> {
    return { data: { status: await this.payments.verify(id, token, body) } };
  }
}

/**
 * POST /v1/webhooks/razorpay. Signature over the RAW body (rawBody: true in NestFactory), dedupe by
 * x-razorpay-event-id, then 200 at once — the work runs in the payments-webhooks queue (Razorpay
 * times out after 5s and retries with backoff for 24h).
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  @Post('razorpay')
  @HttpCode(200)
  async razorpay(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ): Promise<{ received: true; duplicate: boolean }> {
    if (this.provider.name === 'demo') throw new NotFoundException();
    const raw = req.rawBody;
    if (!raw || !signature || !this.provider.verifyWebhookSignature(raw, signature)) throw new UnauthorizedException('Invalid signature');
    if (!eventId || !/^[A-Za-z0-9_-]{1,64}$/.test(eventId)) throw new BadRequestException('Missing or malformed event id');
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new BadRequestException('Malformed JSON');
    }
    const summary = summarize(json);
    if (!summary) throw new BadRequestException('Unreadable event');
    const { duplicate } = await this.webhooks.receive(this.provider.name, eventId, summary);
    return { received: true, duplicate };
  }
}
