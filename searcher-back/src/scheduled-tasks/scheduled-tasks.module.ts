import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduledTasksService } from './scheduled-tasks.service';
import { ScheduledTasksController } from './scheduled-tasks.controller';
import { Invoice } from '../entities/invoice.entity';
import { Bill } from '../entities/bill.entity';
import { InvoicesModule } from '../invoices/invoices.module';
import { BillsModule } from '../bills/bills.module';
import { StoreCredentialsService } from '../shared/store-credentials.service';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, Bill]),
    InvoicesModule,
    BillsModule,
  ],
  controllers: [ScheduledTasksController],
  providers: [
    ScheduledTasksService, 
    StoreCredentialsService,
    ConfigService
  ],
  exports: [ScheduledTasksService],
})
export class ScheduledTasksModule {}
