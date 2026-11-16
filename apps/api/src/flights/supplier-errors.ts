import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  GoneException,
  HttpException,
  type Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { BookingErrorBody } from '@ota/contracts';
import { SupplierError } from '@ota/suppliers';

export const FARE_GONE_MESSAGE = 'This fare is no longer available. Please search again.';

/**
 * 410 FARE_NO_LONGER_AVAILABLE: the fare can't be priced or booked any more (expired, sold out, not
 * in a fresh search, or the supplier's offer request was already booked). The customer must search again.
 */
export function fareNoLongerAvailable(): GoneException {
  const body: BookingErrorBody = { statusCode: 410, code: 'FARE_NO_LONGER_AVAILABLE', message: FARE_GONE_MESSAGE };
  return new GoneException(body);
}

/**
 * Runs a supplier call and turns SupplierError into the matching HTTP error (logged without
 * passenger data — adapter messages only carry supplier codes/titles). Anything else is our bug
 * and propagates as a 500.
 */
export async function callSupplier<T>(logger: Logger, operation: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof SupplierError)) throw err;
    logSupplierError(logger, operation, err);
    throw supplierHttpException(err);
  }
}

export function logSupplierError(logger: Logger, operation: string, err: SupplierError): void {
  const line = `${operation} failed supplier=${err.supplier} code=${err.code}: ${err.message}`;
  if (supplierHttpException(err).getStatus() >= 500) logger.error(line);
  else logger.warn(line);
}

export function supplierHttpException(err: SupplierError): HttpException {
  switch (err.code) {
    case 'INVALID_REQUEST':
      return new BadRequestException('The flight supplier rejected this request');
    case 'OFFER_NOT_FOUND':
    case 'OFFER_EXPIRED':
      return fareNoLongerAvailable();
    case 'PRICE_CHANGED':
      return new UnprocessableEntityException({
        statusCode: 422,
        code: 'PRICE_CHANGED',
        message: 'The price has changed. Please review the new price.',
        ...(err.newTotal ? { newTotal: err.newTotal } : {}),
      });
    case 'TIMEOUT':
      return new GatewayTimeoutException('The flight supplier did not respond in time. Please try again.');
    case 'UNAVAILABLE':
    case 'UPSTREAM_ERROR':
      return new BadGatewayException('The flight supplier is unavailable. Please try again later.');
  }
}
