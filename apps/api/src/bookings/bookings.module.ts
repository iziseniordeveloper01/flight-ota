import { Module } from '@nestjs/common';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { FlightsModule } from '../flights/flights.module.js';
import { InsuranceModule } from '../insurance/insurance.module.js';
import { BookingStore } from './booking-store.service.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { StuckBookingsMonitor } from './stuck-bookings.monitor.js';

// Prisma, Redis and JsonCacheService come from global modules; the supplier adapter and offer
// re-pricing from FlightsModule.
@Module({
  imports: [FlightsModule, InsuranceModule],
  controllers: [BookingsController],
  providers: [BookingStore, BookingsService, StuckBookingsMonitor, FieldEncryptionService],
})
export class BookingsModule {}
