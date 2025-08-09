import { Module } from '@nestjs/common';
import { DataStorageController } from './data-storage.controller';
import { InvoicesModule } from '../invoices/invoices.module';
import { BillsModule } from '../bills/bills.module';
import { StoreCredentialsService } from '../shared/store-credentials.service';

@Module({
  imports: [InvoicesModule, BillsModule],
  controllers: [DataStorageController],
  providers: [StoreCredentialsService],
})
export class DataStorageModule {}
