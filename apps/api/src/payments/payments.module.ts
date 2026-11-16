import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { PaymentProviderModule } from './payment-provider.module.js';
import { PaymentsController, WebhooksController } from './payments.controller.js';
import { MaintenanceProcessor, RefundsProcessor, WebhooksProcessor } from './payments.processors.js';
import { PaymentsService } from './payments.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { RefundsService } from './refunds.service.js';
import { WebhooksService } from './webhooks.service.js';

@Module({
  imports: [BookingsModule, PaymentProviderModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [
    PaymentsService,
    RefundsService,
    WebhooksService,
    ReconciliationService,
    WebhooksProcessor,
    RefundsProcessor,
    MaintenanceProcessor,
  ],
  exports: [PaymentsService, RefundsService, ReconciliationService],
})
export class PaymentsModule {}
