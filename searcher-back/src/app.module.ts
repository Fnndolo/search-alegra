import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InvoicesModule } from './invoices/invoices.module';
import { BillsModule } from './bills/bills.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { DataStorageModule } from './data-storage/data-storage.module';
import { DatabaseCleanupController } from './database-cleanup.controller';

import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { Bill } from './entities/bill.entity';
import { SyncStatus } from './entities/sync-status.entity';
import { User } from './entities/user.entity';
import { ElectronicBillingModule } from './modules/electronic-billing.module';

// New Entities for Kupocell Billing
import { InvoiceSyncLog } from './modules/entities/invoice-sync-log.entity';
import { ProductMapping } from './entities/product-mapping.entity';
import { BankMapping } from './entities/bank-mapping.entity';
import { KupoCatalogCache } from './modules/entities/kupo-catalog-cache.entity';
import { BillingImportJob } from './modules/entities/billing-import-job.entity';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { Category } from './modules/inventory/entities/category.entity';
import { Store } from './modules/inventory/entities/store.entity';
import { Product } from './modules/inventory/entities/product.entity';
import { ProductVariant } from './modules/inventory/entities/product-variant.entity';
import { Variant } from './modules/inventory/entities/variant.entity';
import { Warehouse } from './modules/inventory/entities/warehouse.entity';
import { InventoryMovement } from './modules/inventory/entities/inventory-movement.entity';
import { SystemSettings } from './modules/inventory/entities/system-settings.entity';
import { PurchaseOrder } from './modules/inventory/entities/purchase-order.entity';
import { PurchaseOrderHistory } from './modules/inventory/entities/purchase-order-history.entity';
import { Contact } from './modules/inventory/entities/contact.entity';
import { ProductWarehouseAlegraItem } from './modules/inventory/entities/product-warehouse-alegra-item.entity';
import { AlegraProductCache } from './modules/inventory/entities/alegra-product-cache.entity';
import { ProductImportDraft } from './modules/inventory/entities/product-import-draft.entity';
import { Color } from './modules/inventory/entities/color.entity';
import { SaleSyncIssue } from './modules/inventory/entities/sale-sync-issue.entity';
const { getDatabaseConfig } = require('../config');


@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      ...getDatabaseConfig(),
      entities: [
        Invoice,
        Bill,
        SyncStatus,
        InvoiceSyncLog,
        ProductMapping,
        BankMapping,
        KupoCatalogCache,
        BillingImportJob,
        User,
        // Inventory entities (FK-dependency order: parents first)
        Category,
        Store,
        Product,
        ProductVariant,
        Variant,
        Warehouse,
        InventoryMovement,
        SystemSettings,
        PurchaseOrder,
        PurchaseOrderHistory,
        Contact,
        ProductWarehouseAlegraItem,
        AlegraProductCache,
        ProductImportDraft,
        Color,
        SaleSyncIssue,
      ],
      synchronize: process.env.NODE_ENV !== 'production',
      logging: false,
    }),
    TypeOrmModule.forFeature([
      Invoice,
      Bill,
      SyncStatus
    ]),
    InvoicesModule,
    BillsModule,
    DataStorageModule,
    WebhooksModule,
    ElectronicBillingModule,
    AuthModule,
    UsersModule,
    InventoryModule,
  ],
  controllers: [AppController, DatabaseCleanupController],
  providers: [AppService],
})
export class AppModule { }
