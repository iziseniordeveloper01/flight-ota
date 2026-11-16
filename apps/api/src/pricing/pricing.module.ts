import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { FX_RATE_SOURCE, FrankfurterRateSource } from './fx-rate-source.js';
import { FxService } from './fx.service.js';
import { PricingService } from './pricing.service.js';

@Module({
  providers: [
    {
      provide: FX_RATE_SOURCE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => new FrankfurterRateSource(config.get('FX_API_URL', { infer: true })),
    },
    FxService,
    PricingService,
  ],
  exports: [PricingService],
})
export class PricingModule {}
