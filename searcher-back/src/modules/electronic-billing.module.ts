import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ElectronicBillingService } from './electronic-billing.service';
import { ElectronicBillingController } from './electronic-billing.controller';
import { InvoiceSyncLog } from './entities/invoice-sync-log.entity';
import { ProductMapping } from '../entities/product-mapping.entity';
import { BankMapping } from '../entities/bank-mapping.entity';
import { KupoCatalogCache } from './entities/kupo-catalog-cache.entity';
import { BillingImportJob } from './entities/billing-import-job.entity';

import { Invoice } from '../entities/invoice.entity';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InvoiceSyncLog, ProductMapping, BankMapping, Invoice, KupoCatalogCache, BillingImportJob]),
    SharedModule
  ],
  providers: [ElectronicBillingService],
  controllers: [ElectronicBillingController],
  exports: [ElectronicBillingService]
})
export class ElectronicBillingModule { }
