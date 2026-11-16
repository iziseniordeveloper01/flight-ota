import { Module } from '@nestjs/common';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { FlightsModule } from '../flights/flights.module.js';
import { InsuranceModule } from '../insurance/insurance.module.js';
import { PaymentProviderModule } from '../payments/payment-provider.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { BookingStore } from './booking-store.service.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { StuckBookingsMonitor } from './stuck-bookings.monitor.js';
import { TicketingProcessor } from './ticketing.processor.js';
import { TicketingService } from './ticketing.service.js';

// Prisma, Redis, JsonCacheService and the queues come from global modules; the supplier adapter
// and offer re-pricing from FlightsModule. PaymentsModule and EmailModule build on the exports.
@Module({
  imports: [FlightsModule, InsuranceModule, PricingModule, PaymentProviderModule],
  controllers: [BookingsController],
  providers: [BookingStore, BookingsService, TicketingService, TicketingProcessor, StuckBookingsMonitor, FieldEncryptionService],
  exports: [BookingStore, BookingsService, TicketingService, StuckBookingsMonitor],
})
export class BookingsModule {}
