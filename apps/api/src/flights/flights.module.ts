import { Module } from '@nestjs/common';
import { FlightsController } from './flights.controller.js';
import { FlightsService } from './flights.service.js';
import { supplierProvider } from './supplier.provider.js';

// JsonCacheService comes from the global RedisModule.
@Module({
  controllers: [FlightsController],
  providers: [supplierProvider, FlightsService],
})
export class FlightsModule {}
