import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    @InjectDataSource() private dataSource: DataSource
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth() {
    let dbStatus = 'NOT CONNECTED';
    let dbError = null;
    
    try {
      // Test database connection
      await this.dataSource.query('SELECT 1');
      dbStatus = 'CONNECTED';
    } catch (error) {
      dbStatus = 'ERROR';
      dbError = error.message;
    }

    return {
      status: 'OK',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0',
      database: {
        status: dbStatus,
        url: process.env.DATABASE_URL ? 'CONFIGURED' : 'NOT CONFIGURED',
        error: dbError
      },
      services: {
        alegra_api: process.env.ALEGRA_API_URL ? 'CONFIGURED' : 'NOT CONFIGURED',
        stores: {
          pasto: process.env.PASTO_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED',
          medellin: process.env.MEDELLIN_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED',
          armenia: process.env.ARMENIA_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED',
          pereira: process.env.PEREIRA_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED',
        }
      }
    };
  }

  @Get('debug/data-count')
  async getDataCount() {
    try {
      const invoicesCount = await this.dataSource.query('SELECT COUNT(*) as count FROM invoices');
      const billsCount = await this.dataSource.query('SELECT COUNT(*) as count FROM bills');
      const syncStatusCount = await this.dataSource.query('SELECT COUNT(*) as count FROM sync_status');
      
      // También obtener algunos registros de ejemplo
      const sampleInvoices = await this.dataSource.query('SELECT id, store, date FROM invoices LIMIT 5');
      const sampleBills = await this.dataSource.query('SELECT id, store, date FROM bills LIMIT 5');
      
      return {
        counts: {
          invoices: parseInt(invoicesCount[0].count),
          bills: parseInt(billsCount[0].count),
          syncStatus: parseInt(syncStatusCount[0].count)
        },
        samples: {
          invoices: sampleInvoices,
          bills: sampleBills
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}
