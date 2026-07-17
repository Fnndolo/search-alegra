import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { AlegraProductCache } from '../entities/alegra-product-cache.entity';
import { ProductImportDraft, DraftVariantInput } from '../entities/product-import-draft.entity';
import { Store } from '../entities/store.entity';
import { Category } from '../entities/category.entity';
import { Product } from '../entities/product.entity';
import { ProductVariant } from '../entities/product-variant.entity';
import { Warehouse } from '../entities/warehouse.entity';
import { ProductWarehouseAlegraItem } from '../entities/product-warehouse-alegra-item.entity';
import { InventoryAlegraFactory } from '../alegra/inventory-alegra.factory';
import { ColorService } from './color.service';

export interface SyncAlegraProductCacheResult {
  storeKey: string;
  total: number;
  created: number;
  updated: number;
}

export interface GenerateDraftsResult {
  storeKey: string;
  created: number;
  skipped: number;
}

export interface UpdateImportDraftDto {
  categoryId?: string;
  variants?: DraftVariantInput[];
  salePrice?: number;
  hasIdentifier?: boolean;
  negativeSell?: boolean;
}

/**
 * Imports Alegra items into local drafts, per sede:
 * 1. `syncAlegraProductCache` — pulls ALL Alegra items for a store into `alegra_product_cache`.
 * 2. `generateDrafts` — creates a `ProductImportDraft` per cache row that doesn't have one yet.
 * 3. `updateDraft` — operator fills in category/variants(color+sku)/salePrice/hasIdentifier/negativeSell.
 * 4. `importDraft` — turns a configured draft into a real `Product` + its `ProductVariant`(s),
 *    same methodology as manual product creation (one or more color+sku pairs, no per-variant price).
 *
 * NOTE: Alegra's `reference` field is cached as-is in `alegra_product_cache` but is never used as
 * the local SKU — SKU is always operator-entered and lives in `ProductVariant.sku`.
 */
@Injectable()
export class AlegraImportService {
  private readonly logger = new Logger(AlegraImportService.name);

  constructor(
    @InjectRepository(AlegraProductCache)
    private readonly cacheRepo: Repository<AlegraProductCache>,

    @InjectRepository(ProductImportDraft)
    private readonly draftRepo: Repository<ProductImportDraft>,

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,

    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,

    @InjectRepository(ProductVariant)
    private readonly productVariantRepo: Repository<ProductVariant>,

    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,

    @InjectRepository(ProductWarehouseAlegraItem)
    private readonly pwaiRepo: Repository<ProductWarehouseAlegraItem>,

    private readonly alegraFactory: InventoryAlegraFactory,
    private readonly dataSource: DataSource,

    private readonly colorService: ColorService,
  ) {}

  // ---------------------------------------------------------------------------
  // 1. Alegra item pagination + cache sync
  // ---------------------------------------------------------------------------

  /** Fetches ALL items from Alegra for a store, paginating with limit/start (same pattern as getKupoProducts). */
  async fetchAllAlegraItems(storeKey: string): Promise<any[]> {
    const client = this.alegraFactory.getClient(storeKey);
    const limit = 30;
    let start = 0;
    let page = 1;
    const all: any[] = [];

    this.logger.log(`[fetchAllAlegraItems] store=${storeKey}: starting pagination (limit=${limit})`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.logger.log(`[fetchAllAlegraItems] store=${storeKey}: requesting page ${page} (start=${start})`);
      const res = await this.alegraFactory.requestWithRetry(() =>
        client.get('/items', { params: { limit, start } }),
      );
      const batch: any[] = Array.isArray(res.data) ? res.data : [];
      this.logger.log(
        `[fetchAllAlegraItems] store=${storeKey}: page ${page} returned ${batch.length} item(s), ` +
          `running total=${all.length + batch.length}`,
      );
      if (!batch.length) break;
      all.push(...batch);
      if (batch.length < limit) break;
      start += limit;
      page += 1;
    }

    this.logger.log(`[fetchAllAlegraItems] store=${storeKey}: done, ${all.length} item(s) total`);
    return all;
  }

  async syncAlegraProductCache(storeKey: string): Promise<SyncAlegraProductCacheResult> {
    const key = storeKey?.trim().toLowerCase();
    if (!key) throw new BadRequestException('storeKey is required');

    this.logger.log(`[syncAlegraProductCache] store=${key}: fetching items from Alegra...`);
    const items = await this.fetchAllAlegraItems(key);
    this.logger.log(`[syncAlegraProductCache] store=${key}: upserting ${items.length} item(s) into cache...`);

    // Preload this store's local warehouses once, keyed by their Alegra id, so each item's
    // `inventory.warehouses[0].id` can be resolved to a local Warehouse without an N+1 query.
    const store = await this.storeRepo.findOne({ where: { store_key: key } });
    const localWarehouses = store
      ? await this.warehouseRepo.find({ where: { store: { id: store.id } } })
      : [];
    const warehouseByAlegraId = new Map(
      localWarehouses
        .filter((w) => w.alegra_warehouse_id != null)
        .map((w) => [w.alegra_warehouse_id as number, w]),
    );

    let created = 0;
    let updated = 0;

    for (const [i, item] of items.entries()) {
      const alegraItemId = Number(item?.id);
      if (!alegraItemId || Number.isNaN(alegraItemId)) {
        this.logger.warn(`[syncAlegraProductCache] store=${key}: skipping item at index ${i} — invalid id`);
        continue;
      }

      const existing = await this.cacheRepo.findOne({
        where: { store_key: key, alegra_item_id: alegraItemId },
      });

      // One Alegra item = one warehouse (prefix-per-warehouse convention) — only the first
      // entry of `inventory.warehouses[]` is meaningful here.
      const rawWarehouses: Array<{ id?: number | string }> = item?.inventory?.warehouses ?? [];
      const alegraWarehouseId = rawWarehouses.length ? Number(rawWarehouses[0]?.id) : null;
      const matchedWarehouse =
        alegraWarehouseId != null && !Number.isNaN(alegraWarehouseId)
          ? warehouseByAlegraId.get(alegraWarehouseId)
          : undefined;

      const price = item?.price?.[0]?.price ?? item?.price ?? null;
      const values = {
        store_key: key,
        alegra_item_id: alegraItemId,
        name: String(item?.name ?? '').slice(0, 320),
        reference: item?.reference != null ? String(item.reference).slice(0, 150) : null,
        price: price != null && !Number.isNaN(Number(price)) ? Number(price) : null,
        status: item?.status != null ? String(item.status).slice(0, 20) : null,
        raw: item,
        alegra_warehouse_id:
          alegraWarehouseId != null && !Number.isNaN(alegraWarehouseId) ? alegraWarehouseId : null,
        warehouse_id: matchedWarehouse?.id ?? null,
        synced_at: new Date(),
      };

      if (existing) {
        await this.cacheRepo.update(existing.id, values);
        updated += 1;
      } else {
        await this.cacheRepo.save(this.cacheRepo.create(values));
        created += 1;
      }
    }

    this.logger.log(
      `[syncAlegraProductCache] store=${key} total=${items.length} created=${created} updated=${updated}`,
    );

    return { storeKey: key, total: items.length, created, updated };
  }

  async syncAlegraProductCacheForStores(storeKeys: string[]): Promise<SyncAlegraProductCacheResult[]> {
    const results: SyncAlegraProductCacheResult[] = [];
    for (const storeKey of storeKeys) {
      results.push(await this.syncAlegraProductCache(storeKey));
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // 2. Draft generation
  // ---------------------------------------------------------------------------

  async generateDrafts(storeKey: string): Promise<GenerateDraftsResult> {
    const key = storeKey?.trim().toLowerCase();
    if (!key) throw new BadRequestException('storeKey is required');

    const cacheRows = await this.cacheRepo.find({ where: { store_key: key } });

    let created = 0;
    let skipped = 0;

    for (const cacheRow of cacheRows) {
      const existing = await this.draftRepo.findOne({
        where: { alegra_product_cache_id: cacheRow.id },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      const draft = this.draftRepo.create({
        alegra_product_cache_id: cacheRow.id,
        store_key: key,
        suggested_name: cacheRow.name,
        suggested_sku: cacheRow.reference,
        status: 'pending',
      });
      await this.draftRepo.save(draft);
      created += 1;
    }

    return { storeKey: key, created, skipped };
  }

  // ---------------------------------------------------------------------------
  // 3. Draft listing / configuration
  // ---------------------------------------------------------------------------

  async findDrafts(filters?: {
    storeKey?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: ProductImportDraft[]; total: number }> {
    const take = filters?.limit ?? 50;
    const skip = (filters?.page ?? 0) * take;

    const qb = this.draftRepo
      .createQueryBuilder('draft')
      .leftJoinAndSelect('draft.category', 'category')
      .leftJoinAndSelect('draft.alegra_product_cache', 'cache');

    if (filters?.storeKey) qb.andWhere('draft.store_key = :storeKey', { storeKey: filters.storeKey.toLowerCase() });
    if (filters?.status) qb.andWhere('draft.status = :status', { status: filters.status });
    if (filters?.search) {
      qb.andWhere('(draft.suggested_name ILIKE :term OR draft.suggested_sku ILIKE :term)', {
        term: `%${filters.search}%`,
      });
    }

    qb.orderBy('draft.created_at', 'DESC').take(take).skip(skip);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  /** Counts of drafts per status for a sede — lets the UI show "X pendientes de Y" without loading everything. */
  async countDraftsByStatus(storeKey: string): Promise<{ pending: number; configured: number; imported: number; total: number }> {
    const key = storeKey.trim().toLowerCase();
    const rows = await this.draftRepo
      .createQueryBuilder('draft')
      .select('draft.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('draft.store_key = :key', { key })
      .groupBy('draft.status')
      .getRawMany();

    const byStatus: Record<string, number> = { pending: 0, configured: 0, imported: 0 };
    let total = 0;
    for (const r of rows) {
      const count = Number(r.count) || 0;
      byStatus[r.status] = count;
      total += count;
    }
    return { pending: byStatus.pending, configured: byStatus.configured, imported: byStatus.imported, total };
  }

  async findDraftById(id: string): Promise<ProductImportDraft> {
    const draft = await this.draftRepo.findOne({
      where: { id },
      relations: ['category', 'alegra_product_cache', 'product'],
    });
    if (!draft) throw new NotFoundException(`ProductImportDraft ${id} not found`);
    return draft;
  }

  async updateDraft(id: string, dto: UpdateImportDraftDto): Promise<ProductImportDraft> {
    const draft = await this.findDraftById(id);

    if (draft.status === 'imported') {
      throw new BadRequestException('Draft already imported, cannot be edited');
    }

    if (dto.categoryId !== undefined) {
      const category = await this.categoryRepo.findOne({ where: { id: dto.categoryId } });
      if (!category) throw new NotFoundException(`Category ${dto.categoryId} not found`);
      draft.category = category;
      draft.category_id = category.id;
    }

    if (dto.variants !== undefined) {
      const cleaned = (dto.variants ?? [])
        .map((v) => ({ color: v.color?.trim() ?? '', sku: v.sku?.trim() ?? '' }))
        .filter((v) => v.color || v.sku);

      const skus = new Set<string>();
      for (const v of cleaned) {
        if (!v.color || !v.sku) {
          throw new BadRequestException('Every variant requires both a color and a sku');
        }
        if (skus.has(v.sku)) {
          throw new BadRequestException(`SKU '${v.sku}' is repeated among this draft's variants`);
        }
        skus.add(v.sku);
      }
      draft.variants = cleaned.length ? cleaned : null;
    }
    if (dto.salePrice !== undefined) draft.sale_price = dto.salePrice ?? null;
    if (dto.hasIdentifier !== undefined) draft.has_identifier = dto.hasIdentifier;
    if (dto.negativeSell !== undefined) draft.negative_sell = dto.negativeSell;

    const hasValidVariants = !!draft.variants?.length;
    draft.status = draft.category_id && hasValidVariants ? 'configured' : 'pending';

    return this.draftRepo.save(draft);
  }

  // ---------------------------------------------------------------------------
  // 4. Import — creates the local Product + first ProductVariant
  // ---------------------------------------------------------------------------

  async importDraft(id: string): Promise<ProductImportDraft> {
    const draft = await this.findDraftById(id);

    if (draft.status === 'imported') {
      throw new BadRequestException('Draft already imported');
    }
    if (!draft.category_id || !draft.variants?.length) {
      throw new BadRequestException(
        'Draft is missing required fields: categoryId and at least one variant (color + sku) must be configured before importing',
      );
    }

    const store = await this.storeRepo.findOne({ where: { store_key: draft.store_key } });
    if (!store) throw new NotFoundException(`Store '${draft.store_key}' not found`);

    const category = await this.categoryRepo.findOne({ where: { id: draft.category_id } });
    if (!category) throw new NotFoundException(`Category ${draft.category_id} not found`);

    const variantInputs = draft.variants.map((v) => ({ color: v.color.trim(), sku: v.sku.trim() }));
    const skus = variantInputs.map((v) => v.sku);
    const existingSkus = await this.productVariantRepo.find({ where: { sku: In(skus) } });
    if (existingSkus.length) {
      throw new ConflictException(`SKU(s) already in use: ${existingSkus.map((v) => v.sku).join(', ')}`);
    }

    // `draft.variants[].color` are plain user-typed names (drafts stay free-text) — resolve/create
    // the reusable Color for each before building the ProductVariant(s).
    const resolvedColors = await Promise.all(
      variantInputs.map((v) => this.colorService.findOrCreateColor(v.color)),
    );

    // The Alegra item's warehouse is resolved once at sync time (`syncAlegraProductCache`) into
    // `alegra_product_cache.warehouse_id` — reuse it here instead of re-parsing the raw payload.
    const alegraItemId = draft.alegra_product_cache.alegra_item_id;
    const alegraName = draft.alegra_product_cache.name;
    const cachedWarehouseId = draft.alegra_product_cache.warehouse_id;

    let matchedWarehouse: Warehouse | null = null;
    if (cachedWarehouseId) {
      matchedWarehouse = await this.warehouseRepo.findOne({
        where: { id: cachedWarehouseId, store: { id: store.id } },
      });
    }

    if (draft.alegra_product_cache.alegra_warehouse_id && !matchedWarehouse) {
      this.logger.warn(
        `[importDraft] draft=${draft.id} alegraItemId=${alegraItemId}: item has Alegra warehouse ` +
          `${draft.alegra_product_cache.alegra_warehouse_id} but it didn't match a local Warehouse of ` +
          `store=${store.store_key} — importing without a ProductWarehouseAlegraItem link. ` +
          `Sync warehouses for this store and re-sync the product cache first.`,
      );
    }

    const matchedWarehouses = matchedWarehouse ? [matchedWarehouse] : [];

    await this.dataSource.transaction(async (manager) => {
      const productRepo = manager.getRepository(Product);
      const variantRepo = manager.getRepository(ProductVariant);
      const draftRepo = manager.getRepository(ProductImportDraft);
      const pwaiRepo = manager.getRepository(ProductWarehouseAlegraItem);

      const product = productRepo.create({
        name: draft.suggested_name,
        category,
        store,
        has_identifier: draft.has_identifier ?? true,
        negative_sell: draft.negative_sell ?? false,
        sale_price: draft.sale_price ?? null,
      });
      const savedProduct = await productRepo.save(product);

      for (const [i, input] of variantInputs.entries()) {
        const variant = variantRepo.create({
          product: savedProduct,
          color: resolvedColors[i],
          sku: input.sku,
        });
        await variantRepo.save(variant);
      }

      // Preserve the link to the Alegra item this product came from, per warehouse — this is
      // what lets "publicar en Alegra" recognize it's already created there (no duplicates) and,
      // later, lets us push local edits back to Alegra via updateItemInAlegra.
      for (const warehouse of matchedWarehouses) {
        await pwaiRepo.save(
          pwaiRepo.create({
            product_id: savedProduct.id,
            warehouse_id: warehouse.id,
            store_key: store.store_key,
            alegra_item_id: alegraItemId,
            alegra_name: alegraName,
          }),
        );
      }

      await draftRepo.update(draft.id, {
        status: 'imported',
        product_id: savedProduct.id,
      });

      return savedProduct.id;
    });

    return this.findDraftById(draft.id);
  }
}
