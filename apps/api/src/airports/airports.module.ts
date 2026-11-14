import { Module } from '@nestjs/common';
import { AirportsController } from './airports.controller.js';
import { AirportsService } from './airports.service.js';

// PRISMA and REDIS_CLIENT come from global modules, so no imports are needed here.
@Module({
  controllers: [AirportsController],
  providers: [AirportsService],
})
export class AirportsModule {}
