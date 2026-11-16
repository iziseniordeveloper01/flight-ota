import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module.js';
import { FlightsController } from './flights.controller.js';
import { FlightsService } from './flights.service.js';
import { SUPPLIER_ADAPTER, supplierProvider } from './supplier.provider.js';

// JsonCacheService comes from the global RedisModule. The adapter and FlightsService (offer
// re-pricing) are exported for BookingsModule — still one adapter instance per app.
@Module({
  imports: [PricingModule],
  controllers: [FlightsController],
  providers: [supplierProvider, FlightsService],
  exports: [SUPPLIER_ADAPTER, FlightsService],
})
export class FlightsModule {}
