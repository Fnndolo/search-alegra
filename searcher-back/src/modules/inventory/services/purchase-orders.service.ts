import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not, Repository } from 'typeorm';

import { PurchaseOrder, PurchaseOrderItem } from '../entities/purchase-order.entity';
import { PurchaseOrderHistory } from '../entities/purchase-order-history.entity';
import { Variant } from '../entities/variant.entity';
import { Product } from '../entities/product.entity';
import { ProductVariant } from '../entities/product-variant.entity';
import { ProductWarehouseAlegraItem } from '../entities/product-warehouse-alegra-item.entity';
import { InventoryMovement } from '../entities/inventory-movement.entity';
import { Warehouse } from '../entities/warehouse.entity';
import { Store } from '../entities/store.entity';
import { MovementType } from '../entities/enums';
import { InventoryAlegraFactory } from '../alegra/inventory-alegra.factory';
import { ProductAlegraPublishService } from './product-alegra-publish.service';
import {
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderDto,
  UpdatePurchaseOrderItemDto,
  CancelPurchaseOrderDto,
  ListPurchaseOrdersQuery,
  CreateWarehouseDto,
  CreateWarehouseResult,
} from '../entities/dto/create-purchase-order.dto';

/** Shape expected by syncInventory — subset of CreatePurchaseOrderDto */
interface SyncInventoryDto {
  store: string;
  items: Array<{
    // Resolved to a real id by resolveItemAlegraIds before syncInventory ever sees it.
    alegraItemId?: number | null;
    productVariantId?: string | null;
    requiresSerial: boolean;
    quantity: number;
    // Purchase price for this line — persisted onto each unit's Variant.cost_price.
    price: number;
    units: Array<{ identifier?: string | null }>;
  }>;
}

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    @InjectRepository(PurchaseOrder)
    private readonly orderRepo: Repository<PurchaseOrder>,

    @InjectRepository(PurchaseOrderHistory)
    private readonly historyRepo: Repository<PurchaseOrderHistory>,

    @InjectRepository(Variant)
    private readonly variantRepo: Repository<Variant>,

    @InjectRepository(ProductVariant)
    private readonly productVariantRepo: Repository<ProductVariant>,

    @InjectRepository(ProductWarehouseAlegraItem)
    private readonly pwaiRepo: Repository<ProductWarehouseAlegraItem>,

    @InjectRepository(InventoryMovement)
    private readonly movementRepo: Repository<InventoryMovement>,

    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,

    private readonly dataSource: DataSource,

    private readonly alegraFactory: InventoryAlegraFactory,

    private readonly alegraPublishService: ProductAlegraPublishService,
  ) {}

  // ── create ───────────────────────────────────────────────────────────────────

  /**
   * A product can enter the same order in multiple colors (e.g. 3 Silver + 2 Black of the same
   * phone) as separate lines sharing `alegraItemId` but with different `productVariantId`. What's
   * NOT valid is the exact same (alegraItemId, productVariantId) pair repeated — that's just a
   * duplicate line that should have been one line with a higher quantity instead.
   */
  private assertNoDuplicateVariantLines(
    items: Array<{ productId?: string | null; alegraItemId?: number | null; productVariantId?: string | null }>,
  ): void {
    // Keyed by productId (not alegraItemId): a never-published product has no alegraItemId yet,
    // so two different unpublished products would otherwise collide on the same "undefined" key.
    const seen = new Set<string>();
    for (const item of items) {
      const key = `${item.productId ?? item.alegraItemId}::${item.productVariantId ?? ''}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          `El item ${item.productId ?? item.alegraItemId} está repetido con la misma variante — juntá las cantidades en una sola línea.`,
        );
      }
      seen.add(key);
    }
  }

  async create(dto: CreatePurchaseOrderDto, userId: string | null): Promise<PurchaseOrder> {
    this.assertNoDuplicateVariantLines(dto.items);
    if (dto.draft) {
      return this.createDraft(dto, userId);
    }

    // 0. Ensure every line has an Alegra item — auto-create it (and persist the mapping) for any
    // product never published in this warehouse before. Runs BEFORE the bill so a failure here
    // aborts the whole order: nothing gets created in Alegra's bills nor locally.
    if (!dto.warehouseId) {
      throw new BadRequestException('warehouseId es requerido para crear la orden de compra');
    }
    await this.resolveItemAlegraIds(dto.items, dto.warehouseId);

    // 1. Call Alegra (outside transaction — external side effect)
    const client = this.alegraFactory.getClient(dto.store);
    let alegraResponse: any;
    try {
      const res = await this.alegraFactory.requestWithRetry(() =>
        client.post('/bills', this.buildAlegraPayload(dto)),
      );
      alegraResponse = res.data;
    } catch (err: any) {
      const body = err.response?.data;
      this.logger.error(
        `[PurchaseOrders] Alegra POST /bills failed: ${err.message} | body: ${JSON.stringify(body ?? null)}`,
      );
      throw new BadRequestException(
        body?.message ?? err.message ?? 'Error al crear la factura en Alegra',
      );
    }

    // 2. Resolve store and warehouse entities
    const storeEntity = await this.storeRepo.findOne({ where: { store_key: dto.store } });
    let warehouseEntity: Warehouse | null = null;
    if (dto.warehouseId) {
      warehouseEntity = await this.warehouseRepo.findOne({ where: { id: dto.warehouseId } });
    }

    // 3. Build items JSONB (alegraItemId already resolved by resolveItemAlegraIds above)
    const orderItems: PurchaseOrderItem[] = dto.items.map((item) => ({
      alegraItemId: item.alegraItemId!,
      productId: item.productId ?? null,
      productVariantId: item.productVariantId ?? null,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      subtotal: item.price * item.quantity,
      requiresSerial: item.requiresSerial,
      units: item.units.map((u) => ({ identifier: u.identifier ?? null })),
    }));

    // 4. DB transaction: order save + history + inventory sync
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let savedOrder!: PurchaseOrder;
    try {
      const order = qr.manager.create(PurchaseOrder, {
        store: dto.store,
        store_local: storeEntity,
        alegra_id: alegraResponse.id ?? null,
        alegra_status: 'sync',
        status: 'active',
        date: dto.date,
        due_date: dto.dueDate,
        provider: {
          id: dto.providerId,
          name: dto.providerName,
          identification: dto.providerIdentification,
        },
        warehouse: { id: dto.alegraWarehouseId, name: dto.alegraWarehouseName },
        warehouse_local: warehouseEntity,
        observations: dto.observations ?? null,
        total: alegraResponse.total ?? null,
        items: orderItems,
        inventory_synced: false,
        inventory_error: null,
        alegra_data: alegraResponse,
      });
      savedOrder = await qr.manager.save(PurchaseOrder, order);

      await this.saveHistory(
        savedOrder.id,
        'created',
        {
          alegra_id: alegraResponse.id,
          bill_number: alegraResponse.numberTemplate?.fullNumber ?? null,
          total: savedOrder.total,
        },
        userId,
        qr.manager,
      );

      // Inventory sync (failure saves error but does NOT abort the transaction)
      try {
        const duplicates = await this.syncInventory(
          savedOrder,
          { store: dto.store, items: dto.items },
          storeEntity,
          warehouseEntity,
          qr.manager,
        );

        if (duplicates.length > 0) {
          // Do NOT mark inventory_synced=true here — those identifiers were never actually
          // created, so the order needs to keep showing up as pending (getSyncLogs/getSyncCount)
          // and retryInventory must stay able to run again once the conflict is resolved.
          savedOrder.status = 'serial_duplicated';
          savedOrder.inventory_synced = false;
          savedOrder.inventory_error = this.describeSerialDuplicates(duplicates);
          savedOrder = await qr.manager.save(PurchaseOrder, savedOrder);
          await this.saveHistory(savedOrder.id, 'serial_conflict', { duplicates }, userId, qr.manager);
          await this.saveHistory(
            savedOrder.id,
            'inventory_synced',
            { success: false, error: savedOrder.inventory_error },
            userId,
            qr.manager,
          );
        } else {
          savedOrder.inventory_synced = true;
          savedOrder.inventory_error = null;
          savedOrder = await qr.manager.save(PurchaseOrder, savedOrder);
          await this.saveHistory(
            savedOrder.id,
            'inventory_synced',
            { success: true, units_processed: dto.items.reduce((acc, i) => acc + i.quantity, 0) },
            userId,
            qr.manager,
          );
        }
      } catch (syncErr: any) {
        this.logger.error(
          `[PurchaseOrders] Inventory sync failed for order ${savedOrder.id}: ${syncErr.message}`,
          syncErr.stack,
        );
        savedOrder.inventory_error = syncErr.message;
        savedOrder = await qr.manager.save(PurchaseOrder, savedOrder);
        await this.saveHistory(
          savedOrder.id,
          'inventory_synced',
          { success: false, error: syncErr.message },
          userId,
          qr.manager,
        );
      }

      await qr.commitTransaction();
    } catch (err: any) {
      await qr.rollbackTransaction();

      // Compensate: attempt to delete the Alegra bill so it doesn't become an orphan
      try {
        await this.alegraFactory.requestWithRetry(() =>
          client.delete(`/bills/${alegraResponse.id}`),
        );
        this.logger.warn(
          `[PurchaseOrders] Compensation: deleted Alegra bill ${alegraResponse.id} after DB transaction failure`,
        );
      } catch (compensateErr: any) {
        this.logger.error(
          `[PurchaseOrders] CRITICAL: failed to delete Alegra bill ${alegraResponse.id} after DB failure — MANUAL CLEANUP REQUIRED: ${compensateErr.message}`,
          compensateErr.stack,
        );
      }

      throw err;
    } finally {
      await qr.release();
    }

    return savedOrder;
  }

  // ── createDraft ──────────────────────────────────────────────────────────────

  private async createDraft(
    dto: CreatePurchaseOrderDto,
    userId: string | null,
  ): Promise<PurchaseOrder> {
    // alegraItemId may still be unresolved here (0 = pending) — a draft never touches Alegra;
    // resolveItemAlegraIds runs later, in submitDraft, right before the bill is created.
    const orderItems: PurchaseOrderItem[] = dto.items.map((item) => ({
      alegraItemId: item.alegraItemId ?? 0,
      productId: item.productId ?? null,
      productVariantId: item.productVariantId ?? null,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      subtotal: item.price * item.quantity,
      requiresSerial: item.requiresSerial,
      units: item.units.map((u) => ({ identifier: u.identifier ?? null })),
    }));

    // Resolve warehouse_local from warehouseId (audit fix: was missing)
    let warehouseEntity: Warehouse | null = null;
    if (dto.warehouseId) {
      warehouseEntity = await this.warehouseRepo.findOne({ where: { id: dto.warehouseId } });
    }
    const storeEntity = await this.storeRepo.findOne({ where: { store_key: dto.store } });

    const order = this.orderRepo.create({
      store: dto.store,
      store_local: storeEntity,
      alegra_id: null,
      alegra_status: 'not_sync',
      status: 'draft',
      date: dto.date,
      due_date: dto.dueDate,
      provider: {
        id: dto.providerId ?? 0,
        name: dto.providerName ?? '',
        identification: dto.providerIdentification,
      },
      warehouse: { id: dto.alegraWarehouseId ?? '', name: dto.alegraWarehouseName ?? '' },
      warehouse_local: warehouseEntity,
      observations: dto.observations ?? null,
      total: orderItems.reduce((acc, i) => acc + i.subtotal, 0),
      items: orderItems,
      inventory_synced: false,
      inventory_error: null,
      alegra_data: null,
    });

    const saved = await this.orderRepo.save(order);
    await this.saveHistory(saved.id, 'draft_created', { draft: true }, userId);
    return saved;
  }

  // ── submitDraft ──────────────────────────────────────────────────────────────

  async submitDraft(id: number, userId: string | null): Promise<PurchaseOrder> {
    const order = await this.orderRepo.findOne({ where: { id }, relations: ['warehouse_local'] });
    if (!order) throw new NotFoundException(`Purchase order ${id} not found`);
    if (order.status !== 'draft') {
      throw new BadRequestException(`Order ${id} is not a draft (current status: ${order.status})`);
    }

    // 0. Same auto-create-in-Alegra guarantee as `create()` — a draft can be built with products
    // that were never published, since drafts never touch Alegra until this point.
    const draftWarehouseId = (order.warehouse_local as Warehouse | null)?.id;
    if (!draftWarehouseId) {
      throw new BadRequestException('El borrador no tiene bodega asignada — no se puede facturar en Alegra');
    }
    await this.resolveItemAlegraIds(order.items, draftWarehouseId);

    // 1. POST to Alegra (outside transaction)
    const client = this.alegraFactory.getClient(order.store);
    let alegraResponse: any;
    try {
      const res = await this.alegraFactory.requestWithRetry(() =>
        client.post('/bills', this.buildAlegraPayloadFromOrder(order)),
      );
      alegraResponse = res.data;
    } catch (err: any) {
      const body = err.response?.data;
      this.logger.error(
        `[PurchaseOrders] submitDraft: Alegra POST /bills failed for order ${id}: ${err.message} | body: ${JSON.stringify(body ?? null)}`,
      );
      throw new BadRequestException(
        body?.message ?? err.message ?? 'Error al crear la factura en Alegra',
      );
    }

    // 2. Resolve entities for inventory sync
    const storeEntity = await this.storeRepo.findOne({ where: { store_key: order.store } });
    const warehouseEntity = order.warehouse_local
      ? await this.warehouseRepo.findOne({
          where: { id: (order.warehouse_local as Warehouse).id },
        })
      : null;

    // 3. DB transaction: promote order + history + inventory sync
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let savedOrder!: PurchaseOrder;
    try {
      order.alegra_id = alegraResponse.id ?? null;
      order.alegra_status = 'sync';
      order.status = 'active';
      order.alegra_data = alegraResponse;
      order.total = alegraResponse.total ?? order.total;
      order.inventory_synced = false;
      order.inventory_error = null;

      savedOrder = await qr.manager.save(PurchaseOrder, order);

      await this.saveHistory(
        savedOrder.id,
        'submitted',
        {
          alegra_id: alegraResponse.id,
          bill_number: alegraResponse.numberTemplate?.fullNumber ?? null,
          total: savedOrder.total,
        },
        userId,
        qr.manager,
      );

      // Inventory sync (failure saves error but does NOT abort the transaction)
      try {
        const duplicates = await this.syncInventory(
          savedOrder,
          { store: savedOrder.store, items: savedOrder.items },
          storeEntity,
          warehouseEntity,
          qr.manager,
        );

        if (duplicates.length > 0) {
          savedOrder.status = 'serial_duplicated';
          savedOrder.inventory_synced = false;
          savedOrder.inventory_error = this.describeSerialDuplicates(duplicates);
          savedOrder = await qr.manager.save(PurchaseOrder, savedOrder);
          await this.saveHistory(savedOrder.id, 'serial_conflict', { duplicates }, userId, qr.manager);
          await this.saveHistory(
            savedOrder.id,
            'inventory_synced',
            { success: false, error: savedOrder.inventory_error },
            userId,
            qr.manager,
          );
        } else {
          savedOrder.inventory_synced = true;
          savedOrder.inventory_error = null;
          savedOrder = await qr.manager.save(PurchaseOrder, savedOrder);
          await this.saveHistory(
            savedOrder.id,
            'inventory_synced',
            {
              success: true,
              units_processed: savedOrder.items.reduce((acc, i) => acc + i.quantity, 0),
            },
            userId,
            qr.manager,
          );
        }
      } catch (syncErr: any) {
        this.logger.error(
          `[PurchaseOrders] submitDraft: Inventory sync failed for order ${savedOrder.id}: ${syncErr.message}`,
          syncErr.stack,
        );
        savedOrder.inventory_error = syncErr.message;
        savedOrder = await qr.manager.save(PurchaseOrder, savedOrder);
        await this.saveHistory(
          savedOrder.id,
          'inventory_synced',
          { success: false, error: syncErr.message },
          userId,
          qr.manager,
        );
      }

      await qr.commitTransaction();
    } catch (err: any) {
      await qr.rollbackTransaction();

      // Compensate: attempt to delete the Alegra bill so it doesn't become an orphan
      try {
        await this.alegraFactory.requestWithRetry(() =>
          client.delete(`/bills/${alegraResponse.id}`),
        );
        this.logger.warn(
          `[PurchaseOrders] submitDraft: Compensation: deleted Alegra bill ${alegraResponse.id} after DB failure for order ${id}`,
        );
      } catch (compensateErr: any) {
        this.logger.error(
          `[PurchaseOrders] submitDraft: CRITICAL: failed to delete Alegra bill ${alegraResponse.id} after DB failure for order ${id} — MANUAL CLEANUP REQUIRED: ${compensateErr.message}`,
          compensateErr.stack,
        );
      }

      throw err;
    } finally {
      await qr.release();
    }

    return savedOrder;
  }

  // ── deleteDraft ──────────────────────────────────────────────────────────────

  async deleteDraft(id: number): Promise<{ deleted: boolean }> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Purchase order ${id} not found`);
    if (order.status !== 'draft') {
      throw new BadRequestException('Only draft orders can be deleted');
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      // Hard-delete history rows first (FK constraint), then the order
      await qr.manager.delete(PurchaseOrderHistory, { purchase_order_id: id });
      await qr.manager.delete(PurchaseOrder, { id });
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }

    return { deleted: true };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Resolves each line's `alegraItemId`, creating the item in Alegra (and persisting the
   * product-warehouse mapping) the first time a product is ordered for this warehouse.
   * `createItemInAlegra` is itself idempotent (returns the existing mapping if one is already
   * there), so it's safe to call unconditionally for every line with a `productId`. That mapping
   * is saved permanently as soon as Alegra confirms it — even if the order fails afterwards
   * (bill creation or the local DB transaction), the item stays created for the next attempt.
   */
  private async resolveItemAlegraIds(
    items: Array<{ productId?: string | null; alegraItemId?: number | null }>,
    warehouseId: string,
  ): Promise<void> {
    // Cached by productId: several lines (e.g. different colors) commonly share the same product,
    // so this also owns the "one Alegra item per product" invariant instead of relying on
    // createItemInAlegra's internal idempotency check running once per line.
    const resolved = new Map<string, number>();
    for (const item of items) {
      if (!item.productId) continue; // legacy caller already resolved alegraItemId directly
      let alegraItemId = resolved.get(item.productId);
      if (alegraItemId === undefined) {
        const result = await this.alegraPublishService.createItemInAlegra(item.productId, warehouseId);
        if (!result.alegraItemId) {
          throw new BadRequestException(
            `Alegra no devolvió un id de item válido para el producto ${item.productId}`,
          );
        }
        alegraItemId = result.alegraItemId;
        resolved.set(item.productId, alegraItemId);
      }
      item.alegraItemId = alegraItemId;
    }
  }

  private describeSerialDuplicates(duplicates: string[]): string {
    return (
      `${duplicates.length} identificador(es) duplicado(s) detectado(s): ${duplicates.join(', ')} — ` +
      `ya pertenecen a otra unidad activa. Desactivá/corregí esa unidad y usá "Reintentar inventario" para resolver.`
    );
  }

  private buildAlegraPayload(dto: CreatePurchaseOrderDto): Record<string, any> {
    return {
      date: dto.date,
      dueDate: dto.dueDate,
      provider: { id: dto.providerId },
      warehouse: { id: dto.alegraWarehouseId },
      ...(dto.observations ? { observations: dto.observations } : {}),
      purchases: {
        items: this.buildAlegraPurchaseItems(dto.items),
      },
    };
  }

  /** Builds an Alegra payload from a saved PurchaseOrder (used by submitDraft). */
  private buildAlegraPayloadFromOrder(order: PurchaseOrder): Record<string, any> {
    return {
      date: order.date,
      dueDate: order.due_date,
      provider: { id: order.provider.id },
      warehouse: { id: order.warehouse.id },
      ...(order.observations ? { observations: order.observations } : {}),
      purchases: {
        items: this.buildAlegraPurchaseItems(order.items),
      },
    };
  }

  /**
   * Alegra doesn't know about our local color/variant split — a product is a single item there
   * regardless of how many local lines (one per color) reference it. Two local lines sharing the
   * same `alegraItemId` (e.g. 2 Negro + 2 Azul of the same product) must collapse into ONE Alegra
   * purchase line with the combined quantity and every IMEI listed together, or Alegra shows the
   * same item duplicated on the bill.
   */
  private buildAlegraPurchaseItems(
    items: Array<{ alegraItemId?: number | null; price: number; quantity: number; units: Array<{ identifier?: string | null }> }>,
  ): Array<Record<string, any>> {
    const grouped = new Map<number, { price: number; quantity: number; identifiers: string[] }>();
    for (const item of items) {
      const alegraItemId = item.alegraItemId!;
      const entry = grouped.get(alegraItemId) ?? { price: item.price, quantity: 0, identifiers: [] };
      entry.quantity += item.quantity;
      entry.identifiers.push(...item.units.map((u) => u.identifier ?? '').filter(Boolean));
      grouped.set(alegraItemId, entry);
    }

    return Array.from(grouped.entries()).map(([alegraItemId, entry]) => ({
      id: alegraItemId,
      price: entry.price,
      quantity: entry.quantity,
      discount: 0,
      tax: [],
      observations: this.buildItemObservations(entry.quantity, entry.identifiers),
    }));
  }

  private buildItemObservations(quantity: number, identifiers: string[]): string {
    const lines = [`CANTIDAD INICIAL ${quantity}`];
    identifiers.forEach((s) => lines.push(`*${s.trim()}`));
    return lines.join('\n');
  }

  /**
   * Syncs inventory for a purchase order.
   *
   * @param retryMode - When true, existing variants/movements are silently skipped
   *   instead of being counted as duplicates (idempotent retry behaviour).
   */
  /**
   * Resolves the local product for an Alegra item id. The per-warehouse mapping
   * (product_warehouse_alegra_item) is the ONLY source of truth — the legacy per-store
   * product_alegra_items mapping was removed (never populated in production).
   */
  private async resolveProductForAlegraItem(
    storeKey: string,
    alegraItemId: number,
    manager?: EntityManager,
  ): Promise<Product | null> {
    const pwaiRepo = manager ? manager.getRepository(ProductWarehouseAlegraItem) : this.pwaiRepo;
    const mapping = await pwaiRepo.findOne({
      where: { store_key: storeKey, alegra_item_id: alegraItemId },
      relations: ['product'],
    });
    return mapping?.product ?? null;
  }

  /**
   * Resuelve la ProductVariant (color+sku) para un ítem de la orden de compra.
   * Prioridad: si el payload trae `productVariantId` explícito (elegido en el form de la
   * orden — Fase 4), se usa esa. Si no viene, se cae al fallback documentado: la primera
   * ProductVariant creada para el producto (todo producto tiene al menos una, garantizado
   * por diseño — ver §1 del doc de diseño de inventario).
   */
  private async resolveProductVariant(
    productId: string,
    productVariantId: string | null | undefined,
    manager?: EntityManager,
  ): Promise<ProductVariant | null> {
    const productVariantRepo = manager ? manager.getRepository(ProductVariant) : this.productVariantRepo;

    if (productVariantId) {
      const explicit = await productVariantRepo.findOne({
        where: { id: productVariantId, product: { id: productId } },
      });
      if (explicit) return explicit;
      this.logger.warn(
        `[PurchaseOrders] productVariantId=${productVariantId} does not belong to product ${productId} — falling back to default variant`,
      );
    }

    return productVariantRepo.findOne({
      where: { product: { id: productId } },
      order: { created_at: 'ASC' },
    });
  }

  private async syncInventory(
    order: PurchaseOrder,
    dto: SyncInventoryDto,
    storeEntity: Store | null,
    warehouseEntity: Warehouse | null,
    manager?: EntityManager,
    retryMode = false,
  ): Promise<string[]> {
    const variantRepo = manager ? manager.getRepository(Variant) : this.variantRepo;
    const movementRepo = manager ? manager.getRepository(InventoryMovement) : this.movementRepo;

    const duplicates: string[] = [];
    const reference = `BILL-${order.alegra_id}`;
    const observation = 'Purchase order entry';
    const alegraInvoiceId = order.alegra_id ? String(order.alegra_id) : null;

    for (const item of dto.items) {
      if (!item.alegraItemId) {
        this.logger.warn(
          `[PurchaseOrders] Item without a resolved alegraItemId reached syncInventory (store=${dto.store}) — skipping inventory`,
        );
        continue;
      }
      const product = await this.resolveProductForAlegraItem(dto.store, item.alegraItemId, manager);

      if (!product) {
        this.logger.warn(
          `[PurchaseOrders] No product mapping for alegraItemId=${item.alegraItemId} store=${dto.store} — skipping inventory`,
        );
        continue;
      }

      const productVariant = await this.resolveProductVariant(product.id, item.productVariantId, manager);
      if (!productVariant) {
        this.logger.warn(
          `[PurchaseOrders] Product ${product.id} has no ProductVariant — skipping inventory`,
        );
        continue;
      }

      // has_identifier=false: fungible product tracked by QUANTITY — one product-variant-level
      // movement, no per-unit Variant rows.
      if (!product.has_identifier) {
        if (retryMode) {
          const existing = await movementRepo
            .createQueryBuilder('m')
            .where('m.reference = :ref', { ref: reference })
            .andWhere('m.product_variant_id = :productVariantId', { productVariantId: productVariant.id })
            .getOne();
          if (existing) continue;
        }
        const movement = movementRepo.create({
          variant: undefined,
          product_variant: { id: productVariant.id } as ProductVariant,
          movement_type: MovementType.ENTRY,
          quantity: item.quantity,
          reference,
          observation,
          movement_date: new Date(),
          origin_warehouse: undefined,
          destination_warehouse: warehouseEntity
            ? ({ id: warehouseEntity.id } as Warehouse)
            : undefined,
          store: storeEntity ? ({ id: storeEntity.id } as Store) : undefined,
          alegra_invoice_id: alegraInvoiceId,
        });
        await movementRepo.save(movement);
        continue;
      }

      // has_identifier=true: every physical unit becomes a Variant row (full traceability).
      for (const unit of item.units) {
        const identifier = unit.identifier?.trim() || null;

        // Identifier uniqueness is global (colapsa lo que antes eran imei1/imei2/serial).
        if (identifier) {
          const existing = await variantRepo.findOne({ where: { identifier } });
          if (existing) {
            if (retryMode) {
              // Only skip if THIS order's own bill already created that exact variant on a prior
              // run — otherwise it's still a genuine, unresolved conflict with some other unit and
              // must be reported again (previously this branch silently swallowed it forever,
              // leaving the order permanently stuck in serial_duplicated with no way to recover).
              const ownMovement = await movementRepo.findOne({
                where: { reference, variant: { id: existing.id } },
              });
              if (ownMovement) continue;
            }
            duplicates.push(identifier);
            continue;
          }
        }

        const variant = variantRepo.create({
          product_variant: { id: productVariant.id } as ProductVariant,
          warehouse: warehouseEntity ? ({ id: warehouseEntity.id } as Warehouse) : null,
          identifier,
          cost_price: item.price,
          entry_date: new Date(),
          active: true,
        });
        const savedVariant = await variantRepo.save(variant);

        const movement = movementRepo.create({
          variant: { id: savedVariant.id } as Variant,
          product_variant: undefined,
          movement_type: MovementType.ENTRY,
          quantity: 1,
          reference,
          observation,
          movement_date: new Date(),
          origin_warehouse: undefined,
          destination_warehouse: warehouseEntity
            ? ({ id: warehouseEntity.id } as Warehouse)
            : undefined,
          store: storeEntity ? ({ id: storeEntity.id } as Store) : undefined,
          alegra_invoice_id: alegraInvoiceId,
        });
        await movementRepo.save(movement);
      }
    }

    return duplicates;
  }

  async saveHistory(
    orderId: number,
    action: PurchaseOrderHistory['action'],
    detail: Record<string, any> | null,
    createdBy: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(PurchaseOrderHistory) : this.historyRepo;
    const entry = repo.create({
      purchase_order: { id: orderId } as PurchaseOrder,
      purchase_order_id: orderId,
      action,
      detail,
      created_by: createdBy,
    });
    await repo.save(entry);
  }

  // ── findAll ──────────────────────────────────────────────────────────────────

  async findAll(query: ListPurchaseOrdersQuery): Promise<{
    total: number;
    page: number;
    limit: number;
    data: PurchaseOrder[];
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const qb = this.orderRepo.createQueryBuilder('po').orderBy('po.created_at', 'DESC');

    if (query.store) qb.andWhere('po.store = :store', { store: query.store });
    if (query.status) qb.andWhere('po.status = :status', { status: query.status });
    if (query.dateFrom) qb.andWhere('po.date >= :dateFrom', { dateFrom: query.dateFrom });
    if (query.dateTo) qb.andWhere('po.date <= :dateTo', { dateTo: query.dateTo });
    if (query.search) {
      const term = `%${query.search}%`;
      // `po.items::text` matches the item's Alegra name and provider — but items only store
      // `productVariantId` (a UUID), never the SKU string, so a SKU/UPC search needs an EXISTS
      // subquery joining product_variants to actually resolve it.
      qb.andWhere(
        `(po.alegra_id::text ILIKE :term OR po.provider->>'name' ILIKE :term OR po.items::text ILIKE :term OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(po.items) AS item
          JOIN product_variants pv ON pv.id = (item->>'productVariantId')::uuid
          WHERE pv.sku ILIKE :term
        ))`,
        { term },
      );
    }

    const total = await qb.getCount();
    const data = await qb.skip((page - 1) * limit).take(limit).getMany();

    return { total, page, limit, data };
  }

  // ── findOne ──────────────────────────────────────────────────────────────────

  async findOne(id: number): Promise<{ order: PurchaseOrder; history: PurchaseOrderHistory[] }> {
    const order = await this.orderRepo.findOne({ where: { id }, relations: ['warehouse_local'] });
    if (!order) throw new NotFoundException(`Purchase order ${id} not found`);

    const history = await this.historyRepo.find({
      where: { purchase_order_id: id },
      order: { created_at: 'DESC' },
    });

    return { order, history };
  }

  // ── update ───────────────────────────────────────────────────────────────────

  async update(id: number, dto: UpdatePurchaseOrderDto, userId: string | null): Promise<PurchaseOrder> {
    const order = await this.orderRepo.findOne({ where: { id }, relations: ['warehouse_local'] });
    if (!order) throw new NotFoundException(`Purchase order ${id} not found`);
    if (order.status === 'cancelled') throw new BadRequestException('Cannot edit a cancelled order');

    // Draft path: local-only update, no Alegra call, no inventory sync
    if (order.status === 'draft') {
      const changedFields: string[] = [];
      const track = (field: string, changed: boolean) => { if (changed) changedFields.push(field); };

      if (dto.date !== undefined) {
        track('date', dto.date !== order.date);
        order.date = dto.date;
      }
      if (dto.dueDate !== undefined) {
        track('due_date', dto.dueDate !== order.due_date);
        order.due_date = dto.dueDate;
      }
      if (dto.observations !== undefined) {
        track('observations', dto.observations !== order.observations);
        order.observations = dto.observations;
      }
      if (dto.providerId !== undefined) {
        const newProvider = {
          id: dto.providerId,
          name: dto.providerName ?? order.provider.name,
          identification: dto.providerIdentification ?? order.provider.identification,
        };
        track('provider', JSON.stringify(newProvider) !== JSON.stringify(order.provider));
        order.provider = newProvider;
      }
      if (dto.alegraWarehouseId !== undefined || dto.alegraWarehouseName !== undefined) {
        const newWarehouse = {
          id: dto.alegraWarehouseId ?? order.warehouse.id,
          name: dto.alegraWarehouseName ?? order.warehouse.name,
        };
        track('warehouse', JSON.stringify(newWarehouse) !== JSON.stringify(order.warehouse));
        order.warehouse = newWarehouse;
      }
      if (dto.warehouseId !== undefined) {
        const newWarehouseLocal = dto.warehouseId
          ? await this.warehouseRepo.findOne({ where: { id: dto.warehouseId } })
          : null;
        track('warehouse_local', (newWarehouseLocal?.id ?? null) !== (order.warehouse_local?.id ?? null));
        order.warehouse_local = newWarehouseLocal;
      }
      if (dto.store !== undefined) {
        track('store', dto.store !== order.store);
        order.store = dto.store;
        order.store_local = await this.storeRepo.findOne({ where: { store_key: dto.store } });
      }
      if (dto.items !== undefined) {
        this.assertNoDuplicateVariantLines(dto.items);
        const newItems = dto.items.map((item) => ({
          alegraItemId: item.alegraItemId ?? 0,
          productId: item.productId ?? null,
          productVariantId: item.productVariantId ?? null,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          subtotal: item.price * item.quantity,
          requiresSerial: item.requiresSerial,
          units: item.units.map((u) => ({ identifier: u.identifier ?? null })),
        }));
        track('items', JSON.stringify(newItems) !== JSON.stringify(order.items));
        order.items = newItems;
        order.total = order.items.reduce((acc, i) => acc + i.subtotal, 0);
      }

      const saved = await this.orderRepo.save(order);
      if (changedFields.length) {
        await this.saveHistory(saved.id, 'draft_updated', { changed_fields: changedFields }, userId);
      }
      return saved;
    }

    // Non-draft: guard against calling Alegra when alegra_id is missing
    const client = this.alegraFactory.getClient(order.store);
    let alegraCompensationPayload: Record<string, any> | null = null;

    if (order.alegra_id === null) {
      this.logger.warn(
        `[PurchaseOrders] update() called on order ${id} with null alegra_id and status '${order.status}' — skipping Alegra call`,
      );
    } else {
      if (dto.items) this.assertNoDuplicateVariantLines(dto.items);

      // Build partial Alegra payload
      const alegraUpdate: Record<string, any> = {};
      if (dto.date) alegraUpdate.date = dto.date;
      if (dto.dueDate) alegraUpdate.dueDate = dto.dueDate;
      if (dto.observations !== undefined) alegraUpdate.observations = dto.observations;
      if (dto.providerId) alegraUpdate.provider = { id: dto.providerId };
      if (dto.items) {
        alegraUpdate.purchases = {
          items: this.buildAlegraPurchaseItems(dto.items),
        };
      }

      if (Object.keys(alegraUpdate).length > 0) {
        // Snapshot the pre-update state (built from the order as it still is, untouched) so the
        // DB-transaction catch block below can PUT it back to Alegra if the local write fails —
        // same compensation idea as create()'s DELETE, adapted to an edit that can't just be undone.
        alegraCompensationPayload = {
          date: order.date,
          dueDate: order.due_date,
          ...(order.observations ? { observations: order.observations } : {}),
          provider: { id: order.provider.id },
          purchases: { items: this.buildAlegraPurchaseItems(order.items) },
        };

        try {
          await this.alegraFactory.requestWithRetry(() =>
            client.put(`/bills/${order.alegra_id}`, alegraUpdate),
          );
        } catch (err: any) {
          const body = err.response?.data;
          this.logger.error(
            `[PurchaseOrders] Alegra PUT /bills/${order.alegra_id} failed: ${err.message} | body: ${JSON.stringify(body ?? null)}`,
          );
          throw new BadRequestException(
            body?.message ?? err.message ?? 'Error al actualizar en Alegra',
          );
        }
      }
    }

    const changedFields = Object.keys(dto);

    // DB transaction: local field updates + inventory sync + history. If anything here throws
    // after Alegra already accepted the PUT above, roll back the DB and revert the Alegra bill
    // to its pre-update snapshot instead of leaving the two systems out of sync.
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    let saved!: PurchaseOrder;
    try {
      if (dto.date) order.date = dto.date;
      if (dto.dueDate) order.due_date = dto.dueDate;
      if (dto.observations !== undefined) order.observations = dto.observations;
      if (dto.providerId) {
        order.provider = {
          id: dto.providerId,
          name: dto.providerName ?? order.provider.name,
          identification: dto.providerIdentification ?? order.provider.identification,
        };
      }

      if (dto.items) {
        // This path edits an order already invoiced in Alegra — every line must already reference
        // a real, resolved item (unlike a draft, there's no auto-create step here).
        for (const item of dto.items) {
          if (!item.alegraItemId) {
            throw new BadRequestException(
              `El item del producto ${item.productId} no tiene un alegraItemId resuelto — no se puede editar una orden ya facturada con este item.`,
            );
          }
        }
        // Only sync inventory if the order has been previously synced
        if (order.inventory_synced) {
          await this.syncInventoryOnEdit(order, dto.items, userId, qr.manager);
        }
        order.items = dto.items.map((item) => ({
          alegraItemId: item.alegraItemId!,
          productId: item.productId ?? null,
          productVariantId: item.productVariantId ?? null,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          subtotal: item.price * item.quantity,
          requiresSerial: item.requiresSerial,
          units: item.units.map((u) => ({ identifier: u.identifier ?? null })),
        }));
      }

      saved = await qr.manager.save(PurchaseOrder, order);
      await this.saveHistory(saved.id, 'edited', { changed_fields: changedFields }, userId, qr.manager);

      await qr.commitTransaction();
    } catch (err: any) {
      await qr.rollbackTransaction();

      if (alegraCompensationPayload) {
        try {
          await this.alegraFactory.requestWithRetry(() =>
            client.put(`/bills/${order.alegra_id}`, alegraCompensationPayload),
          );
          this.logger.warn(
            `[PurchaseOrders] update: Compensation: reverted Alegra bill ${order.alegra_id} to its pre-update state after DB transaction failure`,
          );
        } catch (compensateErr: any) {
          this.logger.error(
            `[PurchaseOrders] update: CRITICAL: failed to revert Alegra bill ${order.alegra_id} after DB failure — MANUAL CLEANUP REQUIRED: ${compensateErr.message}`,
            compensateErr.stack,
          );
        }
      }

      throw err;
    } finally {
      await qr.release();
    }

    return saved;
  }

  // ── syncInventoryOnEdit ──────────────────────────────────────────────────────

  private async syncInventoryOnEdit(
    order: PurchaseOrder,
    newItems: UpdatePurchaseOrderItemDto[],
    userId: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    const variantRepo = manager ? manager.getRepository(Variant) : this.variantRepo;
    const movementRepo = manager ? manager.getRepository(InventoryMovement) : this.movementRepo;
    const storeRepo = manager ? manager.getRepository(Store) : this.storeRepo;
    const warehouseRepo = manager ? manager.getRepository(Warehouse) : this.warehouseRepo;

    const storeEntity = await storeRepo.findOne({ where: { store_key: order.store } });
    const warehouseEntity = order.warehouse_local
      ? await warehouseRepo.findOne({ where: { id: (order.warehouse_local as Warehouse).id } })
      : null;

    for (const newItem of newItems) {
      // Match by (alegraItemId, productVariantId) — a product can enter the same order in
      // multiple colors (e.g. 3 Silver + 2 Black of the same phone), each as its own line with
      // the same alegraItemId but a different productVariantId. Matching by alegraItemId alone
      // would collapse those lines and cross-attribute IMEIs between colors.
      const oldItem = order.items.find(
        (i) => i.alegraItemId === newItem.alegraItemId && (i.productVariantId ?? null) === (newItem.productVariantId ?? null),
      );

      const product = await this.resolveProductForAlegraItem(order.store, newItem.alegraItemId!, manager);
      if (!product) continue;

      const productVariant = await this.resolveProductVariant(product.id, newItem.productVariantId, manager);
      if (!productVariant) continue;

      const reference = `EDIT-${order.id}`;
      const alegraInvoiceId = order.alegra_id ? String(order.alegra_id) : null;

      // New item not previously in the order → create a full ENTRY movement
      if (!oldItem) {
        if (newItem.requiresSerial) {
          for (const unit of newItem.units) {
            const variant = variantRepo.create({
              product_variant: { id: productVariant.id } as ProductVariant,
              warehouse: warehouseEntity ? ({ id: warehouseEntity.id } as Warehouse) : null,
              identifier: unit.identifier?.trim() || null,
              cost_price: newItem.price,
              entry_date: new Date(),
              active: true,
            });
            const savedVariant = await variantRepo.save(variant);
            const movement = movementRepo.create({
              variant: { id: savedVariant.id } as Variant,
              product_variant: undefined,
              movement_type: MovementType.ENTRY,
              quantity: 1,
              reference,
              observation: 'New item added on order edit',
              movement_date: new Date(),
              destination_warehouse: warehouseEntity
                ? ({ id: warehouseEntity.id } as Warehouse)
                : undefined,
              store: storeEntity ? ({ id: storeEntity.id } as Store) : undefined,
              alegra_invoice_id: alegraInvoiceId,
            });
            await movementRepo.save(movement);
          }
        } else {
          const movement = movementRepo.create({
            variant: undefined,
            product_variant: { id: productVariant.id } as ProductVariant,
            movement_type: MovementType.ENTRY,
            quantity: newItem.quantity,
            reference,
            observation: 'New item added on order edit',
            movement_date: new Date(),
            destination_warehouse: warehouseEntity
              ? ({ id: warehouseEntity.id } as Warehouse)
              : undefined,
            store: storeEntity ? ({ id: storeEntity.id } as Store) : undefined,
            alegra_invoice_id: alegraInvoiceId,
          });
          await movementRepo.save(movement);
        }
        continue;
      }

      // Existing item: handle quantity diff
      const qtyDiff = newItem.quantity - oldItem.quantity;
      if (qtyDiff === 0) continue;

      if (newItem.requiresSerial) {
        if (qtyDiff > 0) {
          const addedUnits = newItem.units.slice(oldItem.quantity);
          for (const unit of addedUnits) {
            const variant = variantRepo.create({
              product_variant: { id: productVariant.id } as ProductVariant,
              warehouse: warehouseEntity ? ({ id: warehouseEntity.id } as Warehouse) : null,
              identifier: unit.identifier?.trim() || null,
              cost_price: newItem.price,
              entry_date: new Date(),
              active: true,
            });
            const savedVariant = await variantRepo.save(variant);
            const movement = movementRepo.create({
              variant: { id: savedVariant.id } as Variant,
              product_variant: undefined,
              movement_type: MovementType.ENTRY,
              quantity: 1,
              reference,
              observation: 'Unit added on order edit',
              movement_date: new Date(),
              destination_warehouse: warehouseEntity
                ? ({ id: warehouseEntity.id } as Warehouse)
                : undefined,
              store: storeEntity ? ({ id: storeEntity.id } as Store) : undefined,
              alegra_invoice_id: alegraInvoiceId,
            });
            await movementRepo.save(movement);
          }
        } else {
          const removedUnits = oldItem.units.slice(newItem.quantity);
          for (const unit of removedUnits) {
            if (!unit.identifier) continue;
            const variant = await variantRepo.findOne({ where: { identifier: unit.identifier } });
            if (!variant) continue;
            variant.active = false;
            variant.exit_date = new Date();
            await variantRepo.save(variant);
            const movement = movementRepo.create({
              variant: { id: variant.id } as Variant,
              product_variant: undefined,
              movement_type: MovementType.EXIT,
              quantity: 1,
              reference,
              observation: 'Unit removed on order edit',
              movement_date: new Date(),
              origin_warehouse: warehouseEntity
                ? ({ id: warehouseEntity.id } as Warehouse)
                : undefined,
              store: storeEntity ? ({ id: storeEntity.id } as Store) : undefined,
              alegra_invoice_id: alegraInvoiceId,
            });
            await movementRepo.save(movement);
          }
        }
      } else {
        const movement = movementRepo.create({
          variant: undefined,
          product_variant: { id: productVariant.id } as ProductVariant,
          movement_type: qtyDiff > 0 ? MovementType.ENTRY : MovementType.EXIT,
          quantity: Math.abs(qtyDiff),
          reference,
          observation: 'Quantity adjustment on order edit',
          movement_date: new Date(),
          destination_warehouse:
            qtyDiff > 0 && warehouseEntity ? ({ id: warehouseEntity.id } as Warehouse) : undefined,
          origin_warehouse:
            qtyDiff < 0 && warehouseEntity ? ({ id: warehouseEntity.id } as Warehouse) : undefined,
          store: storeEntity ? ({ id: storeEntity.id } as Store) : undefined,
          alegra_invoice_id: alegraInvoiceId,
        });
        await movementRepo.save(movement);
      }
    }
  }

  // ── cancel ───────────────────────────────────────────────────────────────────

  async cancel(id: number, dto: CancelPurchaseOrderDto, userId: string | null): Promise<PurchaseOrder> {
    const order = await this.orderRepo.findOne({ where: { id }, relations: ['warehouse_local'] });
    if (!order) throw new NotFoundException(`Purchase order ${id} not found`);
    if (order.status === 'cancelled') throw new BadRequestException('Order is already cancelled');
    if (order.status === 'draft') {
      throw new BadRequestException('Drafts cannot be cancelled — delete them instead');
    }

    const client = this.alegraFactory.getClient(order.store);
    try {
      await this.alegraFactory.requestWithRetry(() =>
        client.delete(`/bills/${order.alegra_id}`),
      );
    } catch (err: any) {
      const body = err.response?.data;
      this.logger.error(
        `[PurchaseOrders] Alegra DELETE /bills/${order.alegra_id} failed: ${err.message} | body: ${JSON.stringify(body ?? null)}`,
      );
      throw new BadRequestException(body?.message ?? err.message ?? 'Error al anular en Alegra');
    }

    // Load duplicated identifiers from serial_conflict history to avoid deactivating variants
    // that were never created by this order (they were detected as duplicates at creation time)
    const conflictHistory = await this.historyRepo.findOne({
      where: { purchase_order_id: id, action: 'serial_conflict' },
      order: { created_at: 'ASC' },
    });
    const duplicatedIdentifiers = new Set<string>(
      (conflictHistory?.detail?.duplicates ?? []) as string[],
    );

    // Load variant ids attributable to this order via its BILL-{alegra_id} movements
    const billRef = `BILL-${order.alegra_id}`;
    const billMovements = await this.movementRepo.find({
      where: { reference: billRef },
      relations: ['variant'],
    });
    const createdVariantIds = new Set<string>(
      billMovements
        .filter((m) => m.variant !== null)
        .map((m) => (m.variant as Variant).id),
    );

    const storeEntity = await this.storeRepo.findOne({ where: { store_key: order.store } });
    const warehouseEntity = order.warehouse_local
      ? await this.warehouseRepo.findOne({ where: { id: (order.warehouse_local as Warehouse).id } })
      : null;

    const egressMovementIds: string[] = [];
    const cancelObservation = dto.reason ? `Cancellation: ${dto.reason}` : 'Purchase order cancellation';
    const alegraInvoiceId = order.alegra_id ? String(order.alegra_id) : null;

    for (const item of order.items) {
      if (item.requiresSerial) {
        for (const unit of item.units) {
          if (!unit.identifier) continue;
          // Skip identifiers that were flagged as duplicates at creation time (never created by this order)
          if (duplicatedIdentifiers.has(unit.identifier)) continue;

          const variant = await this.variantRepo.findOne({ where: { identifier: unit.identifier } });
          if (!variant) continue;
          // Only deactivate variants whose entry movement traces back to this order's bill
          if (!createdVariantIds.has(variant.id)) continue;

          variant.active = false;
          variant.exit_date = new Date();
          await this.variantRepo.save(variant);

          const movement = this.movementRepo.create({
            variant: { id: variant.id } as Variant,
            product_variant: undefined,
            movement_type: MovementType.EXIT,
            quantity: 1,
            reference: `CANCEL-${order.id}`,
            observation: cancelObservation,
            movement_date: new Date(),
            origin_warehouse: warehouseEntity ? ({ id: warehouseEntity.id } as Warehouse) : undefined,
            store: storeEntity ? ({ id: storeEntity.id } as Store) : undefined,
            alegra_invoice_id: alegraInvoiceId,
          });
          const savedMovement = await this.movementRepo.save(movement);
          egressMovementIds.push(savedMovement.id);
        }
      } else {
        const cancelProduct = await this.resolveProductForAlegraItem(order.store, item.alegraItemId);
        if (!cancelProduct) continue;
        const cancelProductVariant = await this.resolveProductVariant(cancelProduct.id, item.productVariantId);
        if (!cancelProductVariant) continue;

        const movement = this.movementRepo.create({
          variant: undefined,
          product_variant: { id: cancelProductVariant.id } as ProductVariant,
          movement_type: MovementType.EXIT,
          quantity: item.quantity,
          reference: `CANCEL-${order.id}`,
          observation: cancelObservation,
          movement_date: new Date(),
          origin_warehouse: warehouseEntity ? ({ id: warehouseEntity.id } as Warehouse) : undefined,
          store: storeEntity ? ({ id: storeEntity.id } as Store) : undefined,
          alegra_invoice_id: alegraInvoiceId,
        });
        const savedMovement = await this.movementRepo.save(movement);
        egressMovementIds.push(savedMovement.id);
      }
    }

    order.status = 'cancelled';
    order.alegra_status = 'void';
    const saved = await this.orderRepo.save(order);

    await this.saveHistory(
      saved.id,
      'cancelled',
      { reason: dto.reason ?? null, egress_movements: egressMovementIds },
      userId,
    );

    return saved;
  }

  // ── getSyncLogs ──────────────────────────────────────────────────────────────

  async getSyncLogs(): Promise<{ order: PurchaseOrder; lastError: PurchaseOrderHistory | null }[]> {
    const orders = await this.orderRepo.find({
      where: { inventory_synced: false, status: Not('draft') as any },
      order: { created_at: 'DESC' },
    });

    if (orders.length === 0) return [];

    const orderIds = orders.map((o) => Number(o.id));

    // Batch-load all relevant history rows in a single query (avoids N+1)
    const historyRows = await this.historyRepo
      .createQueryBuilder('h')
      .where('h.purchase_order_id IN (:...ids)', { ids: orderIds })
      .andWhere('h.action = :action', { action: 'inventory_synced' })
      .orderBy('h.created_at', 'DESC')
      .getMany();

    // Group by order id, keep only the most recent row per order
    const latestByOrder = new Map<number, PurchaseOrderHistory>();
    for (const row of historyRows) {
      const oid = Number(row.purchase_order_id);
      if (!latestByOrder.has(oid)) {
        latestByOrder.set(oid, row);
      }
    }

    return orders.map((order) => ({
      order,
      lastError: latestByOrder.get(Number(order.id)) ?? null,
    }));
  }

  async getSyncCount(): Promise<{ count: number }> {
    const count = await this.orderRepo.count({
      where: { inventory_synced: false, status: Not('draft') as any },
    });
    return { count };
  }

  // ── retryInventory ───────────────────────────────────────────────────────────

  async retryInventory(id: number, userId: string | null): Promise<PurchaseOrder> {
    const order = await this.orderRepo.findOne({ where: { id }, relations: ['warehouse_local'] });
    if (!order) throw new NotFoundException(`Purchase order ${id} not found`);
    if (order.status === 'draft') {
      throw new BadRequestException('Cannot retry inventory for a draft order');
    }
    if (order.inventory_synced) {
      throw new BadRequestException('Inventory is already synced for this order');
    }
    if (order.status === 'cancelled') {
      throw new BadRequestException('Cannot retry a cancelled order');
    }

    const storeEntity = await this.storeRepo.findOne({ where: { store_key: order.store } });
    const warehouseEntity = order.warehouse_local
      ? await this.warehouseRepo.findOne({ where: { id: (order.warehouse_local as Warehouse).id } })
      : null;

    const partialDto: SyncInventoryDto = {
      store: order.store,
      items: order.items.map((item) => ({
        alegraItemId: item.alegraItemId,
        productVariantId: item.productVariantId ?? null,
        requiresSerial: item.requiresSerial,
        quantity: item.quantity,
        price: item.price,
        units: item.units.map((u) => ({ identifier: u.identifier ?? undefined })),
      })),
    };

    try {
      // retryMode=true: existing variants/movements are silently skipped (idempotency)
      const duplicates = await this.syncInventory(
        order,
        partialDto,
        storeEntity,
        warehouseEntity,
        undefined,
        true,
      );

      if (duplicates.length > 0) {
        // Still conflicting — stay in serial_duplicated with inventory_synced=false so this
        // stays retryable (previously this forced inventory_synced=true regardless, which made
        // the order permanently unrecoverable through this same endpoint).
        order.status = 'serial_duplicated';
        order.inventory_synced = false;
        order.inventory_error = this.describeSerialDuplicates(duplicates);
        const saved = await this.orderRepo.save(order);
        await this.saveHistory(saved.id, 'serial_conflict', { duplicates, source: 'retry' }, userId);
        await this.saveHistory(
          saved.id,
          'retry_inventory',
          { success: false, error: saved.inventory_error },
          userId,
        );
        return saved;
      }

      // Conflict resolved (the identifier that was blocking this order is now free) — promote the
      // order back out of serial_duplicated so it isn't stuck showing a stale conflict status.
      if (order.status === 'serial_duplicated') {
        order.status = 'active';
      }
      order.inventory_synced = true;
      order.inventory_error = null;
      const saved = await this.orderRepo.save(order);

      await this.saveHistory(
        saved.id,
        'retry_inventory',
        {
          success: true,
          units_processed: partialDto.items.reduce((acc, i) => acc + i.quantity, 0),
        },
        userId,
      );

      return saved;
    } catch (err: any) {
      this.logger.error(
        `[PurchaseOrders] Retry inventory failed for order ${id}: ${err.message}`,
        err.stack,
      );
      await this.saveHistory(order.id, 'retry_inventory', { success: false, error: err.message }, userId);
      throw new BadRequestException(`Retry failed: ${err.message}`);
    }
  }

  // ── createWarehouse ──────────────────────────────────────────────────────────

  async createWarehouse(dto: CreateWarehouseDto): Promise<CreateWarehouseResult> {
    const client = this.alegraFactory.getClient(dto.store);

    let alegraRes: any;
    try {
      const res = await this.alegraFactory.requestWithRetry(() =>
        client.post('/warehouses', { name: dto.name }),
      );
      alegraRes = res.data;
    } catch (err: any) {
      const body = err.response?.data;
      this.logger.error(
        `[PurchaseOrders] Alegra POST /warehouses failed: ${err.message} | body: ${JSON.stringify(body ?? null)}`,
      );
      throw new BadRequestException(
        body?.message ?? err.message ?? 'Error al crear bodega en Alegra',
      );
    }

    const warehouse = this.warehouseRepo.create({
      store: { id: dto.storeId } as Store,
      name: dto.name,
      is_main: false,
      alegra_warehouse_id: Number(alegraRes.id),
      alegra_store_key: dto.store,
      active: true,
    });
    const saved = await this.warehouseRepo.save(warehouse);

    return {
      alegraWarehouseId: Number(alegraRes.id),
      alegraWarehouseName: alegraRes.name ?? dto.name,
      warehouseId: saved.id,
    };
  }

  // ── updateAlegraStatus ───────────────────────────────────────────────────────

  async updateAlegraStatus(alegraId: number, alegraStatus: string): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { alegra_id: alegraId } });
    if (!order) {
      this.logger.warn(`[PurchaseOrders] bill-updated for unknown alegra_id=${alegraId}`);
      return;
    }

    const previous = order.alegra_status;
    order.alegra_status = alegraStatus as any;
    await this.orderRepo.save(order);

    await this.saveHistory(
      order.id,
      'alegra_status_updated',
      { previous, current: alegraStatus },
      'webhook',
    );
    this.logger.log(
      `[PurchaseOrders] alegra_status updated for order ${order.id}: ${previous} → ${alegraStatus}`,
    );
  }
}
