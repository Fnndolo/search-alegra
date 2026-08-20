import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from '../../shared/shared.module';
import { InvoicesModule } from '../../invoices/invoices.module';

import { Category } from './entities/category.entity';
import { Store } from './entities/store.entity';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { Color } from './entities/color.entity';
import { Variant } from './entities/variant.entity';
import { Warehouse } from './entities/warehouse.entity';
import { InventoryMovement } from './entities/inventory-movement.entity';
import { SystemSettings } from './entities/system-settings.entity';

import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderHistory } from './entities/purchase-order-history.entity';
import { Contact } from './entities/contact.entity';
import { ProductWarehouseAlegraItem } from './entities/product-warehouse-alegra-item.entity';
import { AlegraProductCache } from './entities/alegra-product-cache.entity';
import { ProductImportDraft } from './entities/product-import-draft.entity';
import { SaleSyncIssue } from './entities/sale-sync-issue.entity';
import { ProductAlegraPublishService } from './services/product-alegra-publish.service';
import { AlegraImportService } from './services/alegra-import.service';
import { StoresSeedService } from './services/stores-seed.service';
import { InventoryService } from './services/inventory.service';
import { ColorService } from './services/color.service';
import { InventoryAlegraFactory } from './alegra/inventory-alegra.factory';
import { InventoryAlegraSync } from './services/inventory-alegra-sync.service';
import { InventoryStockService } from './services/inventory-stock.service';
import { InventoryIngresoService } from './services/inventory-ingreso.service';
import { InventoryStatsService } from './services/inventory-stats.service';
import { InventoryController } from './inventory.controller';
import { PurchaseOrdersService } from './services/purchase-orders.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { SaleSyncLogsController } from './sale-sync-logs.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Category,
      Store,
      Product,
      ProductVariant,
      Color,
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
      SaleSyncIssue,
    ]),
    SharedModule,
    InvoicesModule,
  ],
  controllers: [InventoryController, PurchaseOrdersController, SaleSyncLogsController],
  providers: [
    StoresSeedService,
    InventoryService,
    ColorService,
    InventoryAlegraFactory,
    InventoryAlegraSync,
    InventoryStockService,
    InventoryIngresoService,
    InventoryStatsService,
    PurchaseOrdersService,
    ProductAlegraPublishService,
    AlegraImportService,
  ],
  exports: [
    InventoryStockService,
    InventoryService,
    ColorService,
    InventoryAlegraSync,
    InventoryIngresoService,
    InventoryStatsService,
    PurchaseOrdersService,
  ],
})
export class InventoryModule {}
