import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, In, Repository } from 'typeorm';

import { InventoryService } from './inventory.service';
import { Warehouse } from '../entities/warehouse.entity';
import { Store } from '../entities/store.entity';
import { Variant } from '../entities/variant.entity';
import { Product } from '../entities/product.entity';
import { ProductVariant } from '../entities/product-variant.entity';
import { ProductWarehouseAlegraItem } from '../entities/product-warehouse-alegra-item.entity';
import { InventoryMovement } from '../entities/inventory-movement.entity';
import { MovementType } from '../entities/enums';
import { SaleSyncIssue, SaleSyncIssueReason } from '../entities/sale-sync-issue.entity';
import { AlegraProductCache } from '../entities/alegra-product-cache.entity';

@Injectable()
export class InventoryStockService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InventoryStockService.name);

  // Lock a nivel DB: a lo sumo UN movimiento SALE por variant. Sin esto, dos entregas
  // concurrentes del mismo webhook de Alegra (delivery "at-least-once") podrían marcar la misma
  // unidad como vendida dos veces antes de que cualquiera de las dos transacciones commitee.
  // Se crea acá (IF NOT EXISTS) y no vía synchronize — mismo patrón que
  // electronic-billing.service.ts, porque este módulo no tiene infraestructura de migraciones y
  // un índice único parcial no se puede expresar con decoradores de TypeORM.
  async onApplicationBootstrap() {
    try {
      await this.dataSource.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_one_sale_per_variant ON inventory_movements (variant_id) WHERE movement_type = 'SALE' AND variant_id IS NOT NULL`,
      );
    } catch (err: any) {
      this.logger.warn(`No se pudo crear el índice único de venta por variante: ${err.message}`);
    }

    // Same lock for fungible sales: a product_variant can be sold in many different invoices
    // (quantity decrements each time), but never twice for the SAME invoice.
    try {
      await this.dataSource.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_one_sale_per_variant_invoice ON inventory_movements (product_variant_id, alegra_invoice_id) WHERE movement_type = 'SALE' AND product_variant_id IS NOT NULL AND alegra_invoice_id IS NOT NULL`,
      );
    } catch (err: any) {
      this.logger.warn(`No se pudo crear el índice único de venta fungible por invoice: ${err.message}`);
    }
  }

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly dataSource: DataSource,

    @InjectRepository(Variant)
    private readonly variantRepo: Repository<Variant>,

    @InjectRepository(ProductVariant)
    private readonly productVariantRepo: Repository<ProductVariant>,

    @InjectRepository(ProductWarehouseAlegraItem)
    private readonly pwaiRepo: Repository<ProductWarehouseAlegraItem>,

    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,

    @InjectRepository(SaleSyncIssue)
    private readonly saleSyncIssueRepo: Repository<SaleSyncIssue>,
  ) {}

  /**
   * Public read for the sale-sync-logs screen: unresolved lines that `processInvoiceSale`
   * couldn't fully discount automatically, most recent first.
   */
  async getSaleSyncIssues(storeKey?: string): Promise<SaleSyncIssue[]> {
    return this.saleSyncIssueRepo.find({
      where: storeKey ? { resolved: false, store_key: storeKey } : { resolved: false },
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Upserts a `SaleSyncIssue` row for a problematic invoice line, keyed by
   * (store_key, alegra_invoice_id, alegra_item_id) — a retry that still fails updates the same
   * row instead of piling up duplicates.
   */
  private async recordSaleSyncIssue(
    manager: EntityManager,
    storeKey: string,
    invoiceId: string | null,
    alegraItemId: number,
    reason: SaleSyncIssueReason,
    details: string,
    quantityExpected: number,
    quantityResolved: number,
  ): Promise<void> {
    if (!invoiceId) return; // nothing to key the row on
    const repo = manager.getRepository(SaleSyncIssue);
    const existing = await repo.findOne({
      where: { store_key: storeKey, alegra_invoice_id: invoiceId, alegra_item_id: alegraItemId },
    });

    if (existing) {
      existing.reason = reason;
      existing.details = details;
      existing.quantity_expected = quantityExpected;
      existing.quantity_resolved = quantityResolved;
      existing.resolved = false;
      await repo.save(existing);
      return;
    }

    await repo.save(
      repo.create({
        store_key: storeKey,
        alegra_invoice_id: invoiceId,
        alegra_item_id: alegraItemId,
        reason,
        details,
        quantity_expected: quantityExpected,
        quantity_resolved: quantityResolved,
        resolved: false,
      }),
    );
  }

  /**
   * Marks any existing UNRESOLVED issue for this exact invoice line as resolved — kept (not
   * deleted) for historical traceability. Called whenever a line that previously failed to
   * auto-discount is later processed successfully (e.g. a retry with fresh Alegra data).
   */
  private async resolveSaleSyncIssue(
    manager: EntityManager,
    storeKey: string,
    invoiceId: string | null,
    alegraItemId: number,
  ): Promise<void> {
    if (!invoiceId) return;
    const repo = manager.getRepository(SaleSyncIssue);
    const existing = await repo.findOne({
      where: {
        store_key: storeKey,
        alegra_invoice_id: invoiceId,
        alegra_item_id: alegraItemId,
        resolved: false,
      },
    });
    if (existing) {
      existing.resolved = true;
      await repo.save(existing);
    }
  }

  async resolveDefaultWarehouse(storeId: string): Promise<Warehouse | null> {
    const main = await this.inventoryService.findMainWarehouse(storeId);
    if (main) return main;
    return this.warehouseRepo.findOne({
      where: { store: { id: storeId }, active: true },
      order: { created_at: 'ASC' },
    });
  }

  // No-op: stock is now derived from variants.exit_date IS NULL.
  // Kept for backward compatibility with callers in inventory-ingreso.service.ts.
  async adjustStock(_variantId: string, _warehouseId: string, _delta: number): Promise<void> {}

  async getStockByVariant(
    variantId: string,
  ): Promise<{ available: number; sold: boolean }> {
    const variant = await this.variantRepo.findOne({ where: { id: variantId } });
    if (!variant) return { available: 0, sold: false };
    return {
      available: variant.exit_date == null ? 1 : 0,
      sold: variant.exit_date != null,
    };
  }

  async getStockByStore(
    storeId: string,
  ): Promise<{ warehouse: Warehouse; variantId: string; available: number }[]> {
    const warehouses = await this.warehouseRepo.find({
      where: { store: { id: storeId }, active: true },
    });
    if (warehouses.length === 0) return [];

    const counts = await this.variantRepo
      .createQueryBuilder('variant')
      .select('variant.warehouse_id', 'warehouseId')
      .addSelect('COUNT(*)', 'available')
      .where('variant.active = true')
      .andWhere('variant.exit_date IS NULL')
      .andWhere('variant.warehouse_id IN (:...warehouseIds)', {
        warehouseIds: warehouses.map((w) => w.id),
      })
      .groupBy('variant.warehouse_id')
      .getRawMany<{ warehouseId: string; available: string }>();

    const availableByWarehouse = new Map(counts.map((c) => [c.warehouseId, Number(c.available)]));

    return warehouses.map((w) => ({
      warehouse: w,
      variantId: '',
      available: availableByWarehouse.get(w.id) ?? 0,
    }));
  }

  /**
   * Reverses whatever `processInvoiceSale` did for this invoice, when Alegra reports the invoice
   * was deleted/cancelled. Reads straight from `inventory_movements` (not the invoice payload) so
   * it works even after the local `Invoice` row is already gone. Reactivates any serialized
   * `Variant` (stock there is derived purely from `exit_date`/`active`) and records a `RETURN`
   * movement for every reversed `SALE` — for fungible items that RETURN is what actually adds the
   * quantity back (see `InventoryService.getProductVariantTotalStock`'s ENTRY/RETURN vs
   * EXIT/SALE/WARRANTY sum). Guarded by `reference: RETURN-{saleId}` so a duplicate delete webhook
   * can't reverse the same sale twice.
   */
  async reverseInvoiceSale(storeKey: string, invoiceId: string): Promise<void> {
    try {
      const store = await this.inventoryService.findStoreByStoreKey(storeKey);
      if (!store) {
        this.logger.warn(`[InventoryStock] reverseInvoiceSale — store not found for storeKey=${storeKey}`);
        return;
      }

      await this.dataSource.transaction(async (manager) => {
        const saleMovements = await manager.find(InventoryMovement, {
          where: { alegra_invoice_id: invoiceId, movement_type: MovementType.SALE, store: { id: store.id } },
          relations: ['variant', 'product_variant', 'origin_warehouse'],
        });

        if (!saleMovements.length) {
          this.logger.log(
            `[InventoryStock] reverseInvoiceSale — no SALE movements found for invoice ${invoiceId}, nothing to reverse`,
          );
          return;
        }

        let reversed = 0;
        for (const sale of saleMovements) {
          const alreadyReturned = await manager.findOne(InventoryMovement, {
            where: { reference: `RETURN-${sale.id}`, movement_type: MovementType.RETURN },
          });
          if (alreadyReturned) continue;

          if (sale.variant) {
            const variant = await manager.findOne(Variant, { where: { id: sale.variant.id } });
            if (variant) {
              variant.exit_date = null;
              variant.active = true;
              await manager.save(Variant, variant);
            }
          }

          await manager.save(
            InventoryMovement,
            manager.create(InventoryMovement, {
              variant: sale.variant ? ({ id: sale.variant.id } as Variant) : null,
              product_variant: sale.product_variant ? ({ id: sale.product_variant.id } as ProductVariant) : null,
              movement_type: MovementType.RETURN,
              quantity: sale.quantity,
              reference: `RETURN-${sale.id}`,
              movement_date: new Date(),
              destination_warehouse: sale.origin_warehouse ?? null,
              store: { id: store.id } as Store,
              alegra_invoice_id: invoiceId,
            }),
          );
          reversed += 1;
        }

        this.logger.log(
          `[InventoryStock] reverseInvoiceSale — reversed ${reversed} SALE movement(s) for invoice ${invoiceId}`,
        );
      });
    } catch (err: any) {
      this.logger.error(
        `[InventoryStock] reverseInvoiceSale failed invoiceId=${invoiceId}: ${err?.message}`,
        err?.stack,
      );
    }
  }

  /**
   * Discounts sold IMEI units when Alegra reports an invoice (sale). Unlike bills/purchase-order
   * items, real Alegra invoice lines never carry the item's numeric id — only `name`, `quantity`
   * and `description` (free text). The Alegra item id is resolved from `item.name` against the
   * catalog cache (`AlegraProductCache`, kept in sync by `AlegraImportService`), then mapped to
   * our local product + warehouse via `ProductWarehouseAlegraItem` (the same mapping purchase
   * orders create). The IMEI itself is free text the salesperson types into `description` when
   * billing, so it's matched by substring against the identifiers of units we already have in
   * stock for that product, not parsed by a fixed format.
   */
  async processInvoiceSale(storeKey: string, invoiceData: any): Promise<void> {
    try {
      const store = await this.inventoryService.findStoreByStoreKey(storeKey);
      if (!store) {
        this.logger.warn(
          `[InventoryStock] processInvoiceSale — store not found for storeKey=${storeKey}`,
        );
        return;
      }

      const invoiceId: string | null = invoiceData?.id ? String(invoiceData.id) : null;

      // Idempotency is per-unit, not per-invoice: `discountInvoiceItem` only ever matches units
      // still `active`/`exit_date IS NULL`, so a unit already sold by a previous delivery of this
      // same webhook is naturally excluded and never gets a second SALE movement. A per-invoice
      // short-circuit here would instead permanently orphan any line that failed to match an IMEI
      // on the first delivery — a retry would skip the whole invoice as soon as ANY line succeeded.

      const items: any[] = Array.isArray(invoiceData?.items) ? invoiceData.items : [];
      if (!items.length) {
        this.logger.warn(
          `[InventoryStock] Invoice ${invoiceId} has no items — nothing to discount`,
        );
        return;
      }

      await this.dataSource.transaction(async (manager) => {
        for (const item of items) {
          await this.discountInvoiceItem(manager, store.id, storeKey, invoiceId, item);
        }
      });

      this.logger.log(
        `[InventoryStock] processInvoiceSale completed for store=${storeKey} invoice=${invoiceId}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[InventoryStock] processInvoiceSale failed storeKey=${storeKey}: ${err?.message}`,
        err?.stack,
      );
    }
  }

  private async discountInvoiceItem(
    manager: EntityManager,
    storeId: string,
    storeKey: string,
    invoiceId: string | null,
    item: any,
  ): Promise<void> {
    const itemName = String(item?.name ?? '').trim();
    const quantity = Number(item?.quantity) || 0;
    if (!itemName || quantity <= 0) {
      this.logger.warn(
        `[InventoryStock] Invoice ${invoiceId} has an item without a valid name/quantity — skipping`,
      );
      return;
    }

    // Alegra invoice lines (unlike bills/purchases) never carry the item's numeric id in
    // practice — only `name`, `description` (free text; holds the IMEI for serialized products)
    // and `quantity` — but check `item.id` first in case some payload shape does include it
    // (bills already rely on it, and being defensive here costs nothing). When it's missing,
    // resolve the real alegra_item_id via the catalog cache (kept in sync by
    // AlegraImportService.syncAlegraProductCache), matching on name instead.
    let alegraItemId = Number(item?.id);
    if (!alegraItemId || Number.isNaN(alegraItemId)) {
      const cached = await manager
        .getRepository(AlegraProductCache)
        .createQueryBuilder('c')
        .where('c.store_key = :storeKey', { storeKey })
        .andWhere('LOWER(c.name) = LOWER(:name)', { name: itemName })
        .getOne();

      if (!cached) {
        const details = `No item id on the invoice line and no cached Alegra item found for name "${itemName}" — run syncAlegraProductCache if this is a new item`;
        this.logger.warn(`[InventoryStock] Invoice ${invoiceId} — ${details}, skipping`);
        await this.recordSaleSyncIssue(manager, storeKey, invoiceId, 0, 'NO_MAPPING', details, quantity, 0);
        return;
      }
      alegraItemId = cached.alegra_item_id;
    }

    const mapping = await manager.findOne(ProductWarehouseAlegraItem, {
      where: { store_key: storeKey, alegra_item_id: alegraItemId },
    });
    if (!mapping) {
      const details = `No local product mapped to Alegra item ${alegraItemId}`;
      this.logger.warn(`[InventoryStock] Invoice ${invoiceId} — ${details}, skipping`);
      await this.recordSaleSyncIssue(
        manager,
        storeKey,
        invoiceId,
        alegraItemId,
        'NO_MAPPING',
        details,
        quantity,
        0,
      );
      return;
    }

    const product = await manager.findOne(Product, { where: { id: mapping.product_id } });
    if (!product) {
      const details = `Mapped product ${mapping.product_id} no longer exists`;
      this.logger.warn(`[InventoryStock] Invoice ${invoiceId} — ${details}, skipping`);
      await this.recordSaleSyncIssue(
        manager,
        storeKey,
        invoiceId,
        alegraItemId,
        'NO_MAPPING',
        details,
        quantity,
        0,
      );
      return;
    }

    if (!product.has_identifier) {
      await this.discountFungibleSale(
        manager,
        storeId,
        storeKey,
        mapping,
        invoiceId,
        alegraItemId,
        quantity,
      );
      return;
    }

    const productVariantIds = (
      await manager.find(ProductVariant, { where: { product: { id: mapping.product_id } } })
    ).map((v) => v.id);
    if (!productVariantIds.length) {
      const details = `Product ${mapping.product_id} has no variants`;
      this.logger.warn(`[InventoryStock] Invoice ${invoiceId} — ${details}, skipping`);
      await this.recordSaleSyncIssue(
        manager,
        storeKey,
        invoiceId,
        alegraItemId,
        'NO_VARIANTS',
        details,
        quantity,
        0,
      );
      return;
    }

    // Ordered FIFO (oldest entry first): if the description ends up matching more IMEIs than the
    // sold quantity (e.g. leftover text from a previous sale), which physical unit gets picked
    // must be deterministic rather than whatever order Postgres happens to return.
    const availableUnits = await manager.find(Variant, {
      where: { product_variant: { id: In(productVariantIds) }, active: true, exit_date: IsNull() },
      order: { entry_date: 'ASC' },
    });

    // The IMEI/serial lives in `description` on real invoice lines (free text a seller types when
    // billing) — Alegra invoices don't have an `observations` field the way purchase-order items do.
    const description: string = typeof item?.description === 'string' ? item.description : '';
    const matched = availableUnits.filter((unit) => unit.identifier && description.includes(unit.identifier));

    if (!matched.length) {
      const details = `Could not match any IMEI in stock against item ${alegraItemId} description: "${description}"`;
      this.logger.warn(`[InventoryStock] Invoice ${invoiceId} — ${details}`);
      await this.recordSaleSyncIssue(
        manager,
        storeKey,
        invoiceId,
        alegraItemId,
        'NO_IMEI_MATCH',
        details,
        quantity,
        0,
      );
      return;
    }

    const soldUnits = matched.slice(0, quantity);
    if (soldUnits.length < quantity) {
      const details = `Item ${alegraItemId} sold quantity=${quantity} but only matched ${soldUnits.length} IMEI(s) in description`;
      this.logger.warn(`[InventoryStock] Invoice ${invoiceId} — ${details}`);
      await this.recordSaleSyncIssue(
        manager,
        storeKey,
        invoiceId,
        alegraItemId,
        'PARTIAL_MATCH',
        details,
        quantity,
        soldUnits.length,
      );
    } else {
      // Full match — auto-resolve any previous issue recorded for this exact invoice line.
      await this.resolveSaleSyncIssue(manager, storeKey, invoiceId, alegraItemId);
    }

    const now = new Date();
    for (const unit of soldUnits) {
      unit.exit_date = now;
      unit.active = false;
      await manager.save(Variant, unit);

      await manager.save(
        InventoryMovement,
        manager.create(InventoryMovement, {
          variant: { id: unit.id } as Variant,
          movement_type: MovementType.SALE,
          quantity: 1,
          reference: invoiceId ? `SALE-${invoiceId}` : null,
          movement_date: now,
          origin_warehouse: { id: mapping.warehouse_id } as Warehouse,
          store: { id: storeId } as Store,
          alegra_invoice_id: invoiceId,
        }),
      );
    }

    this.logger.log(
      `[InventoryStock] Invoice ${invoiceId} — discounted ${soldUnits.length} unit(s) for item ${alegraItemId}`,
    );
  }

  /**
   * Fungible products (no IMEI) are tracked per `ProductVariant` (color/sku) by summing
   * ENTRY/RETURN minus EXIT/SALE/WARRANTY movement quantities (see
   * `InventoryService.getProductVariantTotalStock`) — so discounting a fungible sale only needs
   * a single SALE movement with the sold quantity, no per-unit row to flip.
   *
   * Alegra's invoice item only identifies the Product, not which color variant sold (there's no
   * per-unit IMEI to disambiguate like in `discountInvoiceItem`), so this only auto-resolves when
   * the product has a single variant — with more than one, which color to decrement is unknown
   * and guessing would corrupt stock for the wrong color.
   */
  private async discountFungibleSale(
    manager: EntityManager,
    storeId: string,
    storeKey: string,
    mapping: ProductWarehouseAlegraItem,
    invoiceId: string | null,
    alegraItemId: number,
    quantity: number,
  ): Promise<void> {
    const productVariants = await manager.find(ProductVariant, {
      where: { product: { id: mapping.product_id } },
    });
    if (!productVariants.length) {
      const details = `Product ${mapping.product_id} has no variants`;
      this.logger.warn(`[InventoryStock] Invoice ${invoiceId} — ${details}, skipping`);
      await this.recordSaleSyncIssue(
        manager,
        storeKey,
        invoiceId,
        alegraItemId,
        'NO_VARIANTS',
        details,
        quantity,
        0,
      );
      return;
    }
    if (productVariants.length > 1) {
      const details = `Product ${mapping.product_id} (fungible) has ${productVariants.length} variants; Alegra's invoice doesn't say which one sold — needs manual reconciliation`;
      this.logger.warn(`[InventoryStock] Invoice ${invoiceId} — ${details}, skipping`);
      await this.recordSaleSyncIssue(
        manager,
        storeKey,
        invoiceId,
        alegraItemId,
        'MULTI_VARIANT_FUNGIBLE',
        details,
        quantity,
        0,
      );
      return;
    }

    const productVariant = productVariants[0];

    if (invoiceId) {
      const existing = await manager.findOne(InventoryMovement, {
        where: {
          alegra_invoice_id: invoiceId,
          movement_type: MovementType.SALE,
          product_variant: { id: productVariant.id },
        },
      });
      if (existing) {
        this.logger.log(
          `[InventoryStock] Invoice ${invoiceId} — fungible sale already recorded for variant ${productVariant.id}, skipping`,
        );
        await this.resolveSaleSyncIssue(manager, storeKey, invoiceId, alegraItemId);
        return;
      }
    }

    await manager.save(
      InventoryMovement,
      manager.create(InventoryMovement, {
        product_variant: { id: productVariant.id } as ProductVariant,
        movement_type: MovementType.SALE,
        quantity,
        reference: invoiceId ? `SALE-${invoiceId}` : null,
        movement_date: new Date(),
        origin_warehouse: { id: mapping.warehouse_id } as Warehouse,
        store: { id: storeId } as Store,
        alegra_invoice_id: invoiceId,
      }),
    );

    await this.resolveSaleSyncIssue(manager, storeKey, invoiceId, alegraItemId);

    this.logger.log(
      `[InventoryStock] Invoice ${invoiceId} — discounted ${quantity} unit(s) (fungible) for item ${alegraItemId}`,
    );
  }
}
