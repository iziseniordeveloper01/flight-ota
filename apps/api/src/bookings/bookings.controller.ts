import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createBookingSchema,
  idempotencyKeySchema,
  updateBookingDetailsSchema,
  type AncillariesResponse,
  type BookingResponse,
  type CreateBookingBody,
  type CreateBookingResponse,
  type SeatMapsResponse,
  type UpdateBookingDetailsBody,
  type UpdateBookingDetailsResponse,
} from '@ota/contracts';
import type { Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { Env } from '../config/env.js';
import { BookingIdPipe } from './booking-id.pipe.js';
import { BookingsService } from './bookings.service.js';

// Bookings carry personal data and live prices: never cached anywhere (also on error responses).
const NO_STORE = ['Cache-Control', 'no-store'] as const;
const TOKEN_HEADER = 'x-booking-token';

/**
 * Guest checkout. Only POST /bookings is open; everything else needs the X-Booking-Token returned
 * by create (missing/wrong token → 404, so a booking's existence is never revealed).
 */
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post()
  @Header(...NO_STORE)
  async create(@Body(new ZodValidationPipe(createBookingSchema)) body: CreateBookingBody): Promise<CreateBookingResponse> {
    const { booking, guestToken, priceChanged, previousTotal } = await this.bookings.create(body.offerId);
    return { data: booking, meta: { guestToken, priceChanged, ...(previousTotal ? { previousTotal } : {}) } };
  }

  @Get(':id')
  @Header(...NO_STORE)
  async get(@Param('id', BookingIdPipe) id: string, @Headers(TOKEN_HEADER) token?: string): Promise<BookingResponse> {
    return { data: await this.bookings.get(id, token) };
  }

  @Get(':id/ancillaries')
  @Header(...NO_STORE)
  async ancillaries(
    @Param('id', BookingIdPipe) id: string,
    @Headers(TOKEN_HEADER) token?: string,
  ): Promise<AncillariesResponse> {
    return { data: await this.bookings.ancillaries(id, token) };
  }

  @Get(':id/seat-maps')
  @Header(...NO_STORE)
  async seatMaps(@Param('id', BookingIdPipe) id: string, @Headers(TOKEN_HEADER) token?: string): Promise<SeatMapsResponse> {
    return { data: await this.bookings.seatMaps(id, token) };
  }

  @Put(':id/details')
  @Header(...NO_STORE)
  async updateDetails(
    @Param('id', BookingIdPipe) id: string,
    @Body(new ZodValidationPipe(updateBookingDetailsSchema)) body: UpdateBookingDetailsBody,
    @Headers(TOKEN_HEADER) token?: string,
  ): Promise<UpdateBookingDetailsResponse> {
    const { booking, warnings } = await this.bookings.updateDetails(id, token, body);
    return { data: booking, meta: { warnings } };
  }

  @Post(':id/checkout')
  @HttpCode(200)
  @Header(...NO_STORE)
  async checkout(@Param('id', BookingIdPipe) id: string, @Headers(TOKEN_HEADER) token?: string): Promise<BookingResponse> {
    return { data: await this.bookings.checkout(id, token) };
  }

  /**
   * DEMO ONLY (PAYMENT_PROVIDER=demo): books with Duffel balance (test mode) or the mock without
   * taking any money. 404 with a real payment provider and in production.
   */
  @Post(':id/confirm-demo')
  @Header(...NO_STORE)
  async confirmDemo(
    @Param('id', BookingIdPipe) id: string,
    @Res({ passthrough: true }) res: Response,
    @Headers(TOKEN_HEADER) token?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<BookingResponse> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production' || this.bookings.paymentProvider !== 'demo') {
      throw new NotFoundException();
    }
    const key = idempotencyKeySchema.safeParse(idempotencyKey);
    if (!key.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: [{ path: 'Idempotency-Key', message: key.error.issues[0].message }],
      });
    }
    const { httpStatus, booking } = await this.bookings.confirmDemo(id, token, key.data);
    res.status(httpStatus);
    return { data: booking };
  }
}
