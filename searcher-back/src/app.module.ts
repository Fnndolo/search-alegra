import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InvoicesModule } from './invoices/invoices.module';
import { BillsModule } from './bills/bills.module';
import { DataStorageModule } from './data-storage/data-storage.module';
import { DatabaseCleanupController } from './database-cleanup.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { Bill } from './entities/bill.entity';
import { SyncStatus } from './entities/sync-status.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL, // Para Railway
      host: process.env.DATABASE_HOST || 'localhost', // Para local
      port: parseInt(process.env.DATABASE_PORT || '5432'),
      username: process.env.DATABASE_USERNAME || 'postgres',
      password: process.env.DATABASE_PASSWORD || 'postgres',
      database: process.env.DATABASE_NAME || 'alegra_search',
      entities: [Invoice, Bill, SyncStatus],
      synchronize: true, // Solo para desarrollo, en producción usar migraciones
      logging: false,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }),
    TypeOrmModule.forFeature([Invoice, Bill, SyncStatus]),
    InvoicesModule, 
    BillsModule,
    DataStorageModule
  ],
  controllers: [AppController, DatabaseCleanupController],
  providers: [AppService],
})
export class AppModule {}
