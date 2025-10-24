import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksInitializer } from './webhooks.initializer';
import { InvoicesModule } from '../invoices/invoices.module';
import { BillsModule } from '../bills/bills.module';
import { ConfigModule } from '@nestjs/config';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    ConfigModule,
    SharedModule,
    InvoicesModule,
    BillsModule
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService], // Removido WebhooksInitializer temporalmente
  exports: [WebhooksService]
})
export class WebhooksModule {}