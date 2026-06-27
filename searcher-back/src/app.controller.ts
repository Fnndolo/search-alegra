import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
const {
  getNodeEnv,
  getDatabaseConnectionString,
  getAlegraApiUrl,
  getStoreApiKey,
  getFrontendOrigin,
} = require('../config');

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
      environment: getNodeEnv(),
      version: '1.0.0',
      database: {
        status: dbStatus,
        url: getDatabaseConnectionString() ? 'CONFIGURED' : 'NOT CONFIGURED',
        error: dbError
      },
      services: {
        alegra_api: getAlegraApiUrl() ? 'CONFIGURED' : 'NOT CONFIGURED',
        stores: {
          pasto: getStoreApiKey('pasto') ? 'CONFIGURED' : 'NOT CONFIGURED',
          medellin: getStoreApiKey('medellin') ? 'CONFIGURED' : 'NOT CONFIGURED',
          armenia: getStoreApiKey('armenia') ? 'CONFIGURED' : 'NOT CONFIGURED',
          pereira: getStoreApiKey('pereira') ? 'CONFIGURED' : 'NOT CONFIGURED',
          bogota: getStoreApiKey('bogota') ? 'CONFIGURED' : 'NOT CONFIGURED',
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

  @Get('debug/test-frontend')
  async testFrontendConnection() {
    return {
      message: 'Backend conectado correctamente!',
      timestamp: new Date().toISOString(),
      cors: 'enabled',
      frontend_origin: getFrontendOrigin(),
      test_data: {
        invoices_sample: await this.dataSource.query('SELECT COUNT(*) as count FROM invoices WHERE store = $1', ['pasto']),
        bills_sample: await this.dataSource.query('SELECT COUNT(*) as count FROM bills WHERE store = $1', ['pasto'])
      }
    };
  }

  @Get('debug/cors-test')
  async corsTest() {
    return {
      message: 'CORS test successful!',
      timestamp: new Date().toISOString(),
      headers_received: 'OK',
      cors_status: 'WORKING'
    };
  }
}
