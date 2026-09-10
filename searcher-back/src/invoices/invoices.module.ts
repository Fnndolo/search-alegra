import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoicesDetailService } from './invoices-detail.service';
import { SharedModule } from '../shared/shared.module';
import { Invoice } from '../entities/invoice.entity';
import { SyncStatus } from '../entities/sync-status.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, SyncStatus]), SharedModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicesDetailService],
  exports: [InvoicesService, InvoicesDetailService]
})
export class InvoicesModule {}
