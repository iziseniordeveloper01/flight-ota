import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  GoneException,
  HttpException,
  type Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SupplierError } from '@ota/suppliers';

export const GONE_MESSAGE = 'This offer has expired or is no longer available. Please search again.';

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
      return new GoneException(GONE_MESSAGE);
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
