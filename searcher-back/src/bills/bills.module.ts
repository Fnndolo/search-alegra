import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { BillsDbService } from './bills.service.db';
import { BillsDetailService } from './bills-detail.service';
import { SharedModule } from '../shared/shared.module';
import { Bill } from '../entities/bill.entity';
import { SyncStatus } from '../entities/sync-status.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Bill, SyncStatus]), SharedModule],
  controllers: [BillsController],
  providers: [BillsService, BillsDbService, BillsDetailService],
  exports: [BillsService, BillsDbService, BillsDetailService]
})
export class BillsModule {}
