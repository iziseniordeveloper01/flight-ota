import type { PipeTransform } from '@nestjs/common';
import { bookingIdSchema } from '@ota/contracts';
import { bookingNotFound } from './booking-errors.js';

// A malformed id can't exist: answer exactly like an unknown one (404), not 400.
export class BookingIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!bookingIdSchema.safeParse(value).success) throw bookingNotFound();
    return value;
  }
}
