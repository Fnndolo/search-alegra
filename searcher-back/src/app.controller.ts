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
}
