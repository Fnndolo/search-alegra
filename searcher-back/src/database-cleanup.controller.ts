import { Controller, Delete, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { Bill } from './entities/bill.entity';
import { SyncStatus } from './entities/sync-status.entity';

@Controller('database-cleanup')
export class DatabaseCleanupController {
  constructor(
    @InjectRepository(Invoice)
    private invoiceRepository: Repository<Invoice>,
    @InjectRepository(Bill)
    private billRepository: Repository<Bill>,
    @InjectRepository(SyncStatus)
    private syncStatusRepository: Repository<SyncStatus>,
  ) {}

  @Get('clean-all')
  async cleanAllDataGet() {
    try {
      // Limpiar en orden para evitar problemas de foreign keys
      const syncResult = await this.syncStatusRepository.delete({});
      const invoiceResult = await this.invoiceRepository.delete({});
      const billResult = await this.billRepository.delete({});

      return {
        success: true,
        message: 'All data cleaned successfully',
        details: {
          syncStatus: syncResult.affected || 0,
          invoices: invoiceResult.affected || 0,
          bills: billResult.affected || 0
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Delete('all')
  async cleanAllData() {
    try {
      // Limpiar en orden para evitar problemas de foreign keys
      await this.syncStatusRepository.delete({});
      await this.invoiceRepository.delete({});
      await this.billRepository.delete({});

      return {
        success: true,
        message: 'All data cleaned successfully',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Delete('invoices')
  async cleanInvoices() {
    try {
      const result = await this.invoiceRepository.delete({});
      return {
        success: true,
        message: `${result.affected} invoices deleted`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Delete('bills')
  async cleanBills() {
    try {
      const result = await this.billRepository.delete({});
      return {
        success: true,
        message: `${result.affected} bills deleted`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Delete('sync-status')
  async cleanSyncStatus() {
    try {
      const result = await this.syncStatusRepository.delete({});
      return {
        success: true,
        message: `${result.affected} sync status records deleted`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Get('stats')
  async getStats() {
    try {
      const invoiceCount = await this.invoiceRepository.count();
      const billCount = await this.billRepository.count();
      const syncStatusCount = await this.syncStatusRepository.count();

      return {
        success: true,
        stats: {
          invoices: invoiceCount,
          bills: billCount,
          syncStatus: syncStatusCount
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}
