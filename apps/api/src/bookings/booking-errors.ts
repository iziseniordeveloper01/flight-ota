import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { BookingErrorBody, BookingErrorCode, BookingIssue } from '@ota/contracts';

/** Business error with a machine-readable `code` (body shape: BookingErrorBody). */
export function bookingError(
  status: HttpStatus,
  code: BookingErrorCode,
  message: string,
  extra: Omit<Partial<BookingErrorBody>, 'statusCode' | 'code' | 'message'> = {},
): HttpException {
  const body: BookingErrorBody = { statusCode: status, code, message, ...extra };
  return new HttpException(body, status);
}

/** 422 for rule violations; the first issue's code is the headline. */
export function rulesViolated(issues: BookingIssue[]): HttpException {
  return bookingError(HttpStatus.UNPROCESSABLE_ENTITY, issues[0].code, issues[0].message, { issues });
}

// Same response for "no such booking", "no token" and "wrong token": never reveal existence.
export function bookingNotFound(): NotFoundException {
  return new NotFoundException('Booking not found');
}
