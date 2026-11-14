import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DuffelAdapter, MockSupplier, type SupplierAdapter } from '@ota/suppliers';
import type { Env } from '../config/env.js';

// Everything in the API talks to this token, never to a concrete supplier class.
export const SUPPLIER_ADAPTER = Symbol('SUPPLIER_ADAPTER');

export const supplierProvider: Provider = {
  provide: SUPPLIER_ADAPTER,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): SupplierAdapter => {
    const supplier = config.get('SUPPLIER', { infer: true });
    new Logger('Supplier').log(`Using flight supplier: ${supplier}`);
    switch (supplier) {
      case 'duffel':
        // env.ts guarantees the token is present when SUPPLIER=duffel.
        return new DuffelAdapter({ accessToken: config.getOrThrow('DUFFEL_ACCESS_TOKEN') });
      case 'mock':
        return new MockSupplier();
    }
  },
};
