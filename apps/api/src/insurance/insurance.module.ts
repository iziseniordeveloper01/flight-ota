import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { DemoInsuranceProvider } from './demo-insurance.provider.js';
import { INSURANCE_PROVIDER, type InsuranceProvider } from './insurance.provider.js';

@Module({
  providers: [
    {
      provide: INSURANCE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): InsuranceProvider => {
        switch (config.get('INSURANCE_PROVIDER', { infer: true })) {
          case 'demo':
            return new DemoInsuranceProvider();
        }
      },
    },
  ],
  exports: [INSURANCE_PROVIDER],
})
export class InsuranceModule {}
