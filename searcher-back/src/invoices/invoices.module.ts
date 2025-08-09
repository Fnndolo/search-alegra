import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { StoreCredentialsService } from '../shared/store-credentials.service';
import { Invoice } from '../entities/invoice.entity';
import { SyncStatus } from '../entities/sync-status.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, SyncStatus])],
  controllers: [InvoicesController],
  providers: [InvoicesService, StoreCredentialsService],
  exports: [InvoicesService]
})
export class InvoicesModule {}
