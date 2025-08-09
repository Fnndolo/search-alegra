import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { BillsDbService } from './bills.service.db';
import { StoreCredentialsService } from '../shared/store-credentials.service';
import { Bill } from '../entities/bill.entity';
import { SyncStatus } from '../entities/sync-status.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Bill, SyncStatus])],
  controllers: [BillsController],
  providers: [BillsService, BillsDbService, StoreCredentialsService],
  exports: [BillsDbService]
})
export class BillsModule {}
