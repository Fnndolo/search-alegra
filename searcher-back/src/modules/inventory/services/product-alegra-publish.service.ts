import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Product } from '../entities/product.entity';
import { Warehouse } from '../entities/warehouse.entity';
import { ProductWarehouseAlegraItem } from '../entities/product-warehouse-alegra-item.entity';
import { InventoryAlegraFactory } from '../alegra/inventory-alegra.factory';

export interface PublishResult {
  store: string;
  warehouse: string;
  warehouseId: string;
  status: 'created' | 'existed' | 'adopted' | 'error';
  alegraItemId?: number;
  alegraName?: string;
  error?: string;
}

export interface AlegraStatusRow {
  warehouseId: string;
  warehouseName: string;
  prefix: string | null;
  isMain: boolean;
  created: boolean;
  alegraItemId: number | null;
  alegraName: string | null;
}

/**
 * Publica productos locales como items de Alegra, uno POR BODEGA (dentro de la única sede
 * del producto), nombrado con el prefijo de la bodega (ej. "(P) iPhone 17 Pro Max"). Persiste
 * el mapeo en product_warehouse_alegra_item — el vínculo que permite a las órdenes de compra
 * resolver el producto local y crear variantes/stock.
 */
@Injectable()
export class ProductAlegraPublishService {
  private readonly logger = new Logger(ProductAlegraPublishService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,

    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,

    @InjectRepository(ProductWarehouseAlegraItem)
    private readonly pwaiRepo: Repository<ProductWarehouseAlegraItem>,

    private readonly alegraFactory: InventoryAlegraFactory,
  ) {}

  /** Item name in Alegra = warehouse prefix + product name (main warehouses carry no prefix). */
  buildAlegraItemName(warehouse: Warehouse, product: Product): string {
    const prefix = warehouse.prefix?.trim();
    return prefix ? `${prefix} ${product.name}`.trim() : product.name;
  }

  /**
   * Ensures the Alegra item exists for (product, warehouse) and returns the mapping.
   * Order of resolution: local mapping → adopt by exact name in Alegra → create via POST /items.
   */
  async createItemInAlegra(productId: string, warehouseId: string): Promise<PublishResult> {
    const product = await this.productRepo.findOne({ where: { id: productId }, relations: ['store'] });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);

    const warehouse = await this.warehouseRepo.findOne({
      where: { id: warehouseId },
      relations: ['store'],
    });
    if (!warehouse) throw new NotFoundException(`Warehouse ${warehouseId} not found`);
    if (!warehouse.store) throw new BadRequestException('Warehouse has no store (sede)');
    if (warehouse.store.id !== product.store.id) {
      throw new BadRequestException(
        `La bodega "${warehouse.name}" no pertenece a la sede del producto ("${product.store.name}")`,
      );
    }

    const storeKey = warehouse.store.store_key;
    const base: Omit<PublishResult, 'status'> = {
      store: storeKey,
      warehouse: warehouse.name,
      warehouseId: warehouse.id,
    };

    // 1. Already mapped locally → done (idempotent).
    const existing = await this.pwaiRepo.findOne({
      where: { product_id: product.id, warehouse_id: warehouse.id },
    });
    if (existing) {
      return {
        ...base,
        status: 'existed',
        alegraItemId: existing.alegra_item_id,
        alegraName: existing.alegra_name ?? undefined,
      };
    }

    if (!warehouse.alegra_warehouse_id) {
      throw new BadRequestException(
        `La bodega "${warehouse.name}" no tiene id de Alegra. Sincronizá las bodegas de la sede primero.`,
      );
    }

    const client = this.alegraFactory.getClient(storeKey);
    const itemName = this.buildAlegraItemName(warehouse, product);

    // 2. Adopt an item that already exists in Alegra with this exact name (e.g. created manually).
    try {
      const res = await this.alegraFactory.requestWithRetry(() =>
        client.get('/items', { params: { keywords: itemName, limit: 30 } }),
      );
      const list: any[] = Array.isArray(res.data) ? res.data : [];
      const match = list.find(
        (i) => (i.name ?? '').trim().toLowerCase() === itemName.trim().toLowerCase(),
      );
      if (match) {
        const mapping = await this.saveMapping(product, warehouse, storeKey, Number(match.id), itemName);
        this.logger.log(
          `[publish] Adopted existing Alegra item ${mapping.alegra_item_id} ("${itemName}") store=${storeKey}`,
        );
        return { ...base, status: 'adopted', alegraItemId: mapping.alegra_item_id, alegraName: itemName };
      }
    } catch (err: any) {
      // Name lookup is best-effort; creation below still guards against hard failures.
      this.logger.warn(`[publish] Name lookup failed for "${itemName}" store=${storeKey}: ${err?.message}`);
    }

    // 3. Create the item in Alegra.
    const payload: Record<string, any> = {
      name: itemName,
      type: 'product',
      price: 0,
      inventory: {
        unit: 'unit',
        unitCost: 0,
        warehouses: [{ id: warehouse.alegra_warehouse_id, initialQuantity: 0 }],
      },
    };

    let created: any;
    try {
      const res = await this.alegraFactory.requestWithRetry(() => client.post('/items', payload));
      created = res.data;
    } catch (err: any) {
      const body = err.response?.data;
      this.logger.error(
        `[publish] Alegra POST /items failed store=${storeKey} name="${itemName}": ${err.message} | body: ${JSON.stringify(body ?? null)}`,
      );
      throw new BadRequestException(
        body?.message ?? err.message ?? 'Error al crear el item en Alegra',
      );
    }

    const alegraItemId = Number(created?.id);
    if (!alegraItemId || Number.isNaN(alegraItemId)) {
      throw new BadRequestException('Alegra no devolvió un id de item válido');
    }

    await this.saveMapping(product, warehouse, storeKey, alegraItemId, itemName);
    this.logger.log(
      `[publish] Created Alegra item ${alegraItemId} ("${itemName}") store=${storeKey} warehouse=${warehouse.name}`,
    );
    return { ...base, status: 'created', alegraItemId, alegraName: itemName };
  }

  /**
   * Publica el producto en las bodegas indicadas, todas dentro de la única sede del producto.
   * Falla explícitamente si alguna bodega no pertenece a esa sede. Fallas por bodega no abortan
   * el resto — el caller recibe un resultado por bodega.
   */
  async publishProduct(productId: string, warehouseIds: string[]): Promise<PublishResult[]> {
    const product = await this.productRepo.findOne({ where: { id: productId }, relations: ['store'] });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);

    const results: PublishResult[] = [];
    for (const warehouseId of warehouseIds) {
      try {
        const warehouse = await this.warehouseRepo.findOne({
          where: { id: warehouseId },
          relations: ['store'],
        });
        if (!warehouse) throw new NotFoundException(`Warehouse ${warehouseId} not found`);
        if (!warehouse.store || warehouse.store.id !== product.store.id) {
          throw new BadRequestException(
            `La bodega "${warehouse?.name ?? warehouseId}" no pertenece a la sede del producto ("${product.store.name}")`,
          );
        }

        results.push(await this.createItemInAlegra(productId, warehouseId));
      } catch (err: any) {
        results.push({
          store: product.store.store_key,
          warehouse: '-',
          warehouseId,
          status: 'error',
          error: err?.response?.data?.message ?? err?.message ?? 'error',
        });
      }
    }
    return results;
  }

  /** Estado en Alegra por bodega de la única sede del producto (drives la publish UI y los colores de la OC). */
  async getAlegraStatus(productId: string): Promise<AlegraStatusRow[]> {
    const product = await this.productRepo.findOne({ where: { id: productId }, relations: ['store'] });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);

    const warehouses = await this.warehouseRepo.find({
      where: { store: { id: product.store.id }, active: true },
      order: { name: 'ASC' },
    });

    const mappings = await this.pwaiRepo.find({ where: { product_id: productId } });
    const byWarehouse = new Map(mappings.map((m) => [m.warehouse_id, m]));

    return warehouses
      .sort((a, b) => Number(b.is_main) - Number(a.is_main) || a.name.localeCompare(b.name))
      .map((w) => {
        const m = byWarehouse.get(w.id);
        return {
          warehouseId: w.id,
          warehouseName: w.name,
          prefix: w.prefix,
          isMain: w.is_main,
          created: !!m,
          alegraItemId: m?.alegra_item_id ?? null,
          alegraName: m?.alegra_name ?? null,
        };
      });
  }

  private async saveMapping(
    product: Product,
    warehouse: Warehouse,
    storeKey: string,
    alegraItemId: number,
    alegraName: string,
  ): Promise<ProductWarehouseAlegraItem> {
    const mapping = this.pwaiRepo.create({
      product_id: product.id,
      warehouse_id: warehouse.id,
      store_key: storeKey,
      alegra_item_id: alegraItemId,
      alegra_name: alegraName,
    });
    return this.pwaiRepo.save(mapping);
  }
}
