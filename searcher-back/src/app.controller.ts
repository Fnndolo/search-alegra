import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    return {
      status: 'OK',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0',
      services: {
        database: process.env.DATABASE_URL ? 'CONFIGURED' : 'NOT CONFIGURED',
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
