import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksInitializer } from './webhooks.initializer';
import { InvoicesModule } from '../invoices/invoices.module';
import { BillsModule } from '../bills/bills.module';
import { ConfigModule } from '@nestjs/config';
import { SharedModule } from '../shared/shared.module';
import { WebsocketsModule } from '../websockets/websockets.module';

@Module({
  imports: [
    ConfigModule,
    SharedModule,
    InvoicesModule,
    BillsModule,
    WebsocketsModule
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService], // WebhooksInitializer desactivado - webhooks ya registrados
  exports: [WebhooksService]
})
export class WebhooksModule { }