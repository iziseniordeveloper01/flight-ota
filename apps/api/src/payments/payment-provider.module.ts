import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { FakePaymentProvider } from './fake-payment.provider.js';
import { DemoPaymentProvider, PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.js';
import { RazorpayProvider } from './razorpay.provider.js';

/**
 * The PAYMENT_PROVIDER token, on its own so BookingsModule (booking view, confirm-demo) and
 * PaymentsModule can both use it without depending on each other. e2e tests override the token.
 */
@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PaymentProvider => {
        switch (config.get('PAYMENT_PROVIDER', { infer: true })) {
          case 'razorpay':
            // env.ts guarantees the three secrets when PAYMENT_PROVIDER=razorpay.
            return new RazorpayProvider({
              keyId: config.get('RAZORPAY_KEY_ID', { infer: true })!,
              keySecret: config.get('RAZORPAY_KEY_SECRET', { infer: true })!,
              webhookSecret: config.get('RAZORPAY_WEBHOOK_SECRET', { infer: true })!,
              baseUrl: config.get('RAZORPAY_API_URL', { infer: true }),
            });
          case 'fake':
            return new FakePaymentProvider(); // env.ts allows it only when NODE_ENV=test
          case 'demo':
            return new DemoPaymentProvider();
        }
      },
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentProviderModule {}
