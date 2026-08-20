import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, IsNull } from 'typeorm';

import { Category } from '../entities/category.entity';
import { Store } from '../entities/store.entity';
import { Warehouse } from '../entities/warehouse.entity';
import { Product } from '../entities/product.entity';
import { ProductVariant } from '../entities/product-variant.entity';
import { Color } from '../entities/color.entity';
import { Variant } from '../entities/variant.entity';
import { InventoryMovement } from '../entities/inventory-movement.entity';
import { Contact } from '../entities/contact.entity';
import { ProductWarehouseAlegraItem } from '../entities/product-warehouse-alegra-item.entity';
import { InventoryAlegraFactory } from '../alegra/inventory-alegra.factory';
import { ColorService } from './color.service';
import { InventoryAlegraSync } from './inventory-alegra-sync.service';
import { ProductAlegraPublishService } from './product-alegra-publish.service';

/** Shape used across variant-list responses in this module: `{ id, name, hexCode }`. */
export interface ColorSummary {
  id: string;
  name: string;
  hexCode: string | null;
}

function toColorSummary(color: Color | null | undefined): ColorSummary | null {
  if (!color) return null;
  return { id: color.id, name: color.name, hexCode: color.hex_code };
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CreateCategoryDto {
  name: string;
  description?: string;
}

export interface UpdateCategoryDto {
  name?: string;
  description?: string;
  active?: boolean;
}

export interface CreateProductVariantInput {
  /** Nombre del color tipeado/seleccionado en el autocompletado. Se resuelve vía findOrCreateColor. */
  color?: string;
  /** Id de un color ya existente, elegido directamente en el autocompletado. Tiene prioridad sobre `color`. */
  colorId?: string;
  sku: string;
}

export interface CreateProductDto {
  name: string;
  categoryId: string;
  storeId: string;
  hasIdentifier?: boolean;
  negativeSell?: boolean;
  salePrice?: number;
  variants: CreateProductVariantInput[];
}

export interface UpdateProductDto {
  name?: string;
  categoryId?: string;
  active?: boolean;
  hasIdentifier?: boolean;
  negativeSell?: boolean;
  salePrice?: number;
}

export interface CreateProductVariantDto {
  color?: string;
  colorId?: string;
  sku: string;
}

export interface UpdateProductVariantDto {
  color?: string;
  colorId?: string;
  sku?: string;
  active?: boolean;
}

export interface CreateVariantDto {
  warehouseId?: string;
  identifier?: string;
  barcode?: string;
  entryDate?: Date;
}

export interface UpdateVariantDto {
  warehouseId?: string;
  identifier?: string;
  barcode?: string;
  entryDate?: Date;
  exitDate?: Date;
  active?: boolean;
  salePrice?: number;
}

export interface CreateWarehouseDto {
  name: string;
  isMain?: boolean;
  prefix?: string;
  alegraWarehouseId?: number;
  alegraStoreKey?: string;
}

export interface UpdateWarehouseDto {
  name?: string;
  isMain?: boolean;
  active?: boolean;
  prefix?: string | null;
  alegraWarehouseId?: number;
  alegraStoreKey?: string;
}

// ---------------------------------------------------------------------------

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,

    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,

    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,

    @InjectRepository(ProductVariant)
    private readonly productVariantRepo: Repository<ProductVariant>,

    @InjectRepository(Color)
    private readonly colorRepo: Repository<Color>,

    @InjectRepository(Variant)
    private readonly variantRepo: Repository<Variant>,

    @InjectRepository(InventoryMovement)
    private readonly movementRepo: Repository<InventoryMovement>,

    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,

    @InjectRepository(ProductWarehouseAlegraItem)
    private readonly pwaiRepo: Repository<ProductWarehouseAlegraItem>,

    private readonly dataSource: DataSource,

    private readonly alegraFactory: InventoryAlegraFactory,

    private readonly colorService: ColorService,

    private readonly alegraSync: InventoryAlegraSync,

    private readonly alegraPublishService: ProductAlegraPublishService,
  ) {}

  // -------------------------------------------------------------------------
  // Colors — resolution helper shared by product/variant creation & update
  // -------------------------------------------------------------------------

  /**
   * Resolves a color for a variant input that carries EITHER an already-picked `colorId`
   * (existing color selected in the autocomplete) OR a `color` name to resolve/create on the fly.
   * `colorId` takes priority when both are present. Throws if neither is given.
   */
  private async resolveColorInput(input: { color?: string; colorId?: string }): Promise<Color> {
    if (input.colorId?.trim()) {
      const color = await this.colorRepo.findOne({ where: { id: input.colorId.trim() } });
      if (!color) throw new NotFoundException(`Color ${input.colorId} not found`);
      return color;
    }
    if (input.color?.trim()) {
      return this.colorService.findOrCreateColor(input.color);
    }
    throw new BadRequestException('Either color or colorId is required');
  }

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  findAllCategories(): Promise<Category[]> {
    return this.categoryRepo.find({ order: { name: 'ASC' } });
  }

  async createCategory(dto: CreateCategoryDto): Promise<Category> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Category name is required');
    }
    const existing = await this.categoryRepo.findOne({ where: { name: dto.name.trim() } });
    if (existing) throw new ConflictException(`Category '${dto.name}' already exists`);
    const entity = this.categoryRepo.create({
      name: dto.name.trim(),
      description: dto.description ?? null,
    });
    return this.categoryRepo.save(entity);
  }

  async updateCategory(id: string, dto: UpdateCategoryDto): Promise<Category> {
    const entity = await this.categoryRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Category ${id} not found`);
    Object.assign(entity, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.active !== undefined && { active: dto.active }),
    });
    return this.categoryRepo.save(entity);
  }

  async deleteCategory(id: string): Promise<{ deleted: true }> {
    const entity = await this.categoryRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Category ${id} not found`);

    const productCount = await this.productRepo.count({ where: { category: { id } } });
    if (productCount > 0) {
      throw new ConflictException(
        `No se puede eliminar la categoría "${entity.name}": tiene ${productCount} producto(s) asociado(s).`,
      );
    }

    await this.categoryRepo.remove(entity);
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------

  async findAllProducts(filters?: {
    categoryId?: string;
    storeId?: string;
    active?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: Product[]; total: number }> {
    const take = filters?.limit ?? 50;
    const skip = (filters?.page ?? 0) * take;

    const qb = this.productRepo
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.store', 'store');

    if (filters?.categoryId) qb.andWhere('category.id = :categoryId', { categoryId: filters.categoryId });
    if (filters?.storeId) qb.andWhere('store.id = :storeId', { storeId: filters.storeId });
    if (filters?.active !== undefined) qb.andWhere('product.active = :active', { active: filters.active });
    if (filters?.search) {
      // Búsqueda por nombre del producto o SKU de alguna de sus variantes.
      qb.leftJoin('product.variants', 'variantSearch').andWhere(
        '(product.name ILIKE :term OR variantSearch.sku ILIKE :term)',
        { term: `%${filters.search}%` },
      );
    }

    qb.orderBy('product.name', 'ASC').take(take).skip(skip);

    const [data, total] = await qb.getManyAndCount();

    await this.attachStock(data);
    await this.attachVariantSummaries(data);
    return { data, total };
  }

  /**
   * Adjunta `variants: {id, sku, color}[]` a cada producto de la página actual, en una sola
   * consulta por IN (no N+1). Deliberadamente separado del query principal de `findAllProducts`:
   * un `leftJoinAndSelect` a una relación one-to-many ahí rompería `take`/`skip` (TypeORM aplica
   * el LIMIT sobre filas del join, no sobre productos distintos, antes de agrupar).
   */
  private async attachVariantSummaries(products: Product[]): Promise<void> {
    if (!products.length) return;
    const ids = products.map((p) => p.id);
    const variants = await this.productVariantRepo.find({
      where: { product: { id: In(ids) } },
      relations: ['color', 'product'],
      order: { created_at: 'ASC' },
    });
    const byProduct = new Map<string, any[]>();
    for (const v of variants) {
      const list = byProduct.get(v.product.id) ?? [];
      list.push({ id: v.id, sku: v.sku, active: v.active, color: toColorSummary(v.color) });
      byProduct.set(v.product.id, list);
    }
    for (const p of products) {
      (p as any).variants = byProduct.get(p.id) ?? [];
    }
  }

  /**
   * Anota cada producto con `stock`: la cantidad total disponible en su única sede,
   * combinando unidades serializadas (has_identifier=true) y movimientos por cantidad
   * (has_identifier=false), sumadas a través de todas sus ProductVariant.
   */
  private async attachStock(products: Product[]): Promise<void> {
    const ids = products.map((p) => p.id);
    if (!ids.length) return;

    // Unidades serializadas activas sin salida.
    const variantRows = await this.variantRepo
      .createQueryBuilder('v')
      .innerJoin('v.product_variant', 'pv')
      .select('pv.product_id', 'productId')
      .addSelect('COUNT(*)', 'qty')
      .where('pv.product_id IN (:...ids)', { ids })
      .andWhere('v.active = true')
      .andWhere('v.exit_date IS NULL')
      .groupBy('pv.product_id')
      .getRawMany();

    // Movimientos netos para variantes por cantidad.
    const movementRows = await this.movementRepo
      .createQueryBuilder('m')
      .innerJoin('m.product_variant', 'pv')
      .select('pv.product_id', 'productId')
      .addSelect(
        `SUM(CASE WHEN m.movement_type IN ('ENTRY','RETURN') THEN m.quantity ` +
          `WHEN m.movement_type IN ('EXIT','SALE','WARRANTY') THEN -m.quantity ELSE 0 END)`,
        'qty',
      )
      .where('pv.product_id IN (:...ids)', { ids })
      .groupBy('pv.product_id')
      .getRawMany();

    const map = new Map<string, number>();
    for (const r of variantRows) map.set(r.productId, (map.get(r.productId) ?? 0) + Number(r.qty));
    for (const r of movementRows) map.set(r.productId, (map.get(r.productId) ?? 0) + Number(r.qty));

    for (const p of products) {
      (p as any).stock = map.get(p.id) ?? 0;
    }
  }

  /**
   * Lista los productos activos que YA tienen item de Alegra creado/vinculado en esa bodega
   * específica (vía `ProductWarehouseAlegraItem`), enriquecidos con sus `ProductVariant`
   * (color + sku) para elegir la variante al ingresar unidades en la orden de compra. Productos
   * de la sede que aún no tienen item creado en esta bodega no aparecen — deben publicarse en
   * Alegra para esta bodega primero (ver `ProductAlegraPublishService`).
   */
  async findProductsForWarehouse(
    warehouseId: string,
    filters?: { search?: string; page?: number; limit?: number },
  ): Promise<{
    data: Array<{
      productId: string;
      productName: string;
      hasIdentifier: boolean;
      salePrice: number | null;
      variants: Array<{ id: string; color: ColorSummary | null; sku: string }>;
      alegra: { created: boolean; alegraItemId: number | null; alegraName: string | null };
    }>;
    total: number;
  }> {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: warehouseId }, relations: ['store'] });
    if (!warehouse) throw new NotFoundException(`Warehouse ${warehouseId} not found`);
    if (!warehouse.store) throw new BadRequestException('Warehouse has no store (sede)');

    const take = filters?.limit ?? 50;
    const skip = (filters?.page ?? 0) * take;

    // leftJoin (not innerJoin): products never published in this warehouse must still appear —
    // the purchase-order form needs to offer them so the order can auto-create the Alegra item.
    const qb = this.productRepo
      .createQueryBuilder('product')
      .leftJoin(
        ProductWarehouseAlegraItem,
        'pwai',
        'pwai.product_id = product.id AND pwai.warehouse_id = :warehouseId',
        { warehouseId },
      )
      .leftJoinAndSelect('product.variants', 'variant')
      .leftJoinAndSelect('variant.color', 'variantColor')
      .where('product.store_id = :storeId', { storeId: warehouse.store.id })
      .andWhere('product.active = true');

    if (filters?.search) {
      // Filtering on `variant.sku ILIKE` directly would also drop the NON-matching variant rows
      // from the same `leftJoinAndSelect('product.variants', ...)` used to eager-load them below —
      // a product found by one variant's SKU would come back with ONLY that variant, hiding its
      // other colors. An EXISTS subquery decides which PRODUCTS match without touching which rows
      // the eager-load join returns.
      qb.andWhere(
        `(product.name ILIKE :term OR EXISTS (
          SELECT 1 FROM product_variants pv_search WHERE pv_search.product_id = product.id AND pv_search.sku ILIKE :term
        ))`,
        { term: `%${filters.search}%` },
      );
    }

    qb.orderBy('product.name', 'ASC').take(take).skip(skip);

    const [products, total] = await qb.getManyAndCount();

    const productIds = products.map((p) => p.id);
    const mappings = productIds.length
      ? await this.pwaiRepo.find({ where: { warehouse_id: warehouseId } })
      : [];
    const byProductId = new Map(mappings.map((m) => [m.product_id, m]));

    const data = products.map((product) => {
      const mapping = byProductId.get(product.id);
      return {
        productId: product.id,
        productName: product.name,
        hasIdentifier: product.has_identifier,
        salePrice: product.sale_price,
        variants: (product.variants ?? [])
          .filter((v) => v.active)
          .map((v) => ({ id: v.id, color: toColorSummary(v.color), sku: v.sku })),
        alegra: {
          created: !!mapping,
          alegraItemId: mapping?.alegra_item_id ?? null,
          alegraName: mapping?.alegra_name ?? null,
        },
      };
    });

    return { data, total };
  }

  async findProductById(id: string): Promise<Product> {
    const entity = await this.productRepo.findOne({
      where: { id },
      relations: ['category', 'store', 'variants', 'variants.color'],
    });
    if (!entity) throw new NotFoundException(`Product ${id} not found`);
    return entity;
  }

  /** Crea el producto y sus ProductVariant iniciales (una o más) en una sola transacción. */
  async createProduct(dto: CreateProductDto): Promise<Product> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Product name is required');
    }
    if (!dto.storeId?.trim()) {
      throw new BadRequestException('storeId is required');
    }
    if (!Array.isArray(dto.variants) || dto.variants.length === 0) {
      throw new BadRequestException('At least one variant (color, sku) is required');
    }

    const normalizedVariants = dto.variants.map((variant) => {
      if ((!variant?.color?.trim() && !variant?.colorId?.trim()) || !variant?.sku?.trim()) {
        throw new BadRequestException('Each variant requires a color (or colorId) and a non-empty sku');
      }
      return {
        color: variant.color?.trim(),
        colorId: variant.colorId?.trim(),
        sku: variant.sku.trim(),
      };
    });

    const skusSeen = new Set<string>();
    for (const variant of normalizedVariants) {
      if (skusSeen.has(variant.sku)) {
        throw new BadRequestException(`Duplicate SKU '${variant.sku}' in variants`);
      }
      skusSeen.add(variant.sku);
    }

    const category = await this.categoryRepo.findOne({ where: { id: dto.categoryId } });
    if (!category) throw new NotFoundException(`Category ${dto.categoryId} not found`);

    const store = await this.storeRepo.findOne({ where: { id: dto.storeId } });
    if (!store) throw new NotFoundException(`Store ${dto.storeId} not found`);

    for (const variant of normalizedVariants) {
      const existingSku = await this.productVariantRepo.findOne({ where: { sku: variant.sku } });
      if (existingSku) throw new ConflictException(`SKU '${variant.sku}' already in use`);
    }

    // Resolve colors (find-or-create by name, or validate an existing colorId) before the
    // transaction — findOrCreateColor is idempotent enough that this doesn't need to be atomic
    // with the product/variant insert.
    const resolvedColors = await Promise.all(
      normalizedVariants.map((variant) => this.resolveColorInput(variant)),
    );

    const savedProductId = await this.dataSource.transaction(async (manager) => {
      const productRepo = manager.getRepository(Product);
      const variantRepo = manager.getRepository(ProductVariant);

      const product = productRepo.create({
        name: dto.name.trim(),
        category,
        store,
        has_identifier: dto.hasIdentifier ?? true,
        negative_sell: dto.negativeSell ?? false,
        sale_price: dto.salePrice ?? null,
      });
      const savedProduct = await productRepo.save(product);

      for (let i = 0; i < normalizedVariants.length; i++) {
        const productVariant = variantRepo.create({
          product: savedProduct,
          color: resolvedColors[i],
          sku: normalizedVariants[i].sku,
        });
        await variantRepo.save(productVariant);
      }

      return savedProduct.id;
    });

    return this.findProductById(savedProductId);
  }

  /**
   * Ficha completa de un producto: sus variantes con stock desglosado por bodega de su sede,
   * y las unidades individuales por bodega cuando el producto es serializado (has_identifier=true).
   * Reusa el mismo criterio de cálculo de stock que `attachStock`/`findFungibleStockByStore`:
   * unidades activas sin `exit_date` (serializado) o balance neto de `InventoryMovement`
   * (entradas/devoluciones en `destination_warehouse`, salidas/ventas/garantías en `origin_warehouse`).
   */
  async findProductDetail(id: string): Promise<{
    id: string;
    name: string;
    active: boolean;
    hasIdentifier: boolean;
    negativeSell: boolean;
    salePrice: number | null;
    category: { id: string; name: string };
    store: { id: string; name: string; storeKey: string };
    variants: Array<{
      id: string;
      sku: string;
      active: boolean;
      color: ColorSummary | null;
      stockByWarehouse: Array<{
        warehouseId: string;
        warehouseName: string;
        quantity: number;
        units?: Array<{
          id: string;
          identifier: string | null;
          active: boolean;
          entryDate: Date | null;
          exitDate: Date | null;
        }>;
      }>;
      totalStock: number;
    }>;
  }> {
    const product = await this.productRepo.findOne({
      where: { id },
      relations: ['category', 'store', 'variants', 'variants.color'],
    });
    if (!product) throw new NotFoundException(`Product ${id} not found`);

    const warehouses = await this.warehouseRepo.find({
      where: { store: { id: product.store.id }, active: true },
      order: { created_at: 'ASC' },
    });

    const variants = product.variants ?? [];
    const variantIds = variants.map((v) => v.id);

    // has_identifier = true: unidades individuales agrupadas por (productVariant, warehouse).
    const unitsByKey = new Map<
      string,
      Array<{ id: string; identifier: string | null; active: boolean; entryDate: Date | null; exitDate: Date | null }>
    >();
    const unitQtyByKey = new Map<string, number>();
    if (product.has_identifier && variantIds.length) {
      const units = await this.variantRepo.find({
        where: { product_variant: { id: In(variantIds) } },
        relations: ['product_variant', 'warehouse'],
        order: { created_at: 'ASC' },
      });
      for (const u of units) {
        if (!u.warehouse) continue;
        const key = `${u.product_variant.id}:${u.warehouse.id}`;
        if (!unitsByKey.has(key)) unitsByKey.set(key, []);
        unitsByKey.get(key)!.push({
          id: u.id,
          identifier: u.identifier,
          active: u.active,
          entryDate: u.entry_date,
          exitDate: u.exit_date,
        });
        if (u.active && !u.exit_date) {
          unitQtyByKey.set(key, (unitQtyByKey.get(key) ?? 0) + 1);
        }
      }
    }

    // has_identifier = false: balance neto de InventoryMovement por (productVariant, warehouse).
    const movementQtyByKey = new Map<string, number>();
    if (!product.has_identifier && variantIds.length) {
      const entryRows = await this.movementRepo
        .createQueryBuilder('m')
        .select('m.product_variant_id', 'pvId')
        .addSelect('m.destination_warehouse_id', 'whId')
        .addSelect('SUM(m.quantity)', 'qty')
        .where('m.product_variant_id IN (:...ids)', { ids: variantIds })
        .andWhere("m.movement_type IN ('ENTRY','RETURN')")
        .andWhere('m.destination_warehouse_id IS NOT NULL')
        .groupBy('m.product_variant_id')
        .addGroupBy('m.destination_warehouse_id')
        .getRawMany();
      for (const r of entryRows) {
        const key = `${r.pvId}:${r.whId}`;
        movementQtyByKey.set(key, (movementQtyByKey.get(key) ?? 0) + Number(r.qty));
      }

      const exitRows = await this.movementRepo
        .createQueryBuilder('m')
        .select('m.product_variant_id', 'pvId')
        .addSelect('m.origin_warehouse_id', 'whId')
        .addSelect('SUM(m.quantity)', 'qty')
        .where('m.product_variant_id IN (:...ids)', { ids: variantIds })
        .andWhere("m.movement_type IN ('EXIT','SALE','WARRANTY')")
        .andWhere('m.origin_warehouse_id IS NOT NULL')
        .groupBy('m.product_variant_id')
        .addGroupBy('m.origin_warehouse_id')
        .getRawMany();
      for (const r of exitRows) {
        const key = `${r.pvId}:${r.whId}`;
        movementQtyByKey.set(key, (movementQtyByKey.get(key) ?? 0) - Number(r.qty));
      }
    }

    const variantDtos = variants.map((v) => {
      const stockByWarehouse = warehouses.map((w) => {
        const key = `${v.id}:${w.id}`;
        const quantity = product.has_identifier
          ? unitQtyByKey.get(key) ?? 0
          : movementQtyByKey.get(key) ?? 0;
        const entry: {
          warehouseId: string;
          warehouseName: string;
          quantity: number;
          units?: Array<{
            id: string;
            identifier: string | null;
            active: boolean;
            entryDate: Date | null;
            exitDate: Date | null;
          }>;
        } = { warehouseId: w.id, warehouseName: w.name, quantity };
        if (product.has_identifier) {
          entry.units = unitsByKey.get(key) ?? [];
        }
        return entry;
      });
      const totalStock = stockByWarehouse.reduce((sum, s) => sum + s.quantity, 0);
      return {
        id: v.id,
        sku: v.sku,
        active: v.active,
        color: toColorSummary(v.color),
        stockByWarehouse,
        totalStock,
      };
    });

    return {
      id: product.id,
      name: product.name,
      active: product.active,
      hasIdentifier: product.has_identifier,
      negativeSell: product.negative_sell,
      salePrice: product.sale_price,
      category: { id: product.category.id, name: product.category.name },
      store: { id: product.store.id, name: product.store.name, storeKey: product.store.store_key },
      variants: variantDtos,
    };
  }

  /**
   * Stock total de una ProductVariant en TODAS sus bodegas, con el mismo criterio usado en
   * `findProductDetail`/`attachStock`: unidades activas sin `exit_date` (serializado) o balance
   * neto de `InventoryMovement` (por cantidad). Usado por las guardas de borrado seguro.
   */
  private async getProductVariantTotalStock(productVariant: ProductVariant): Promise<number> {
    if (productVariant.product.has_identifier) {
      return this.variantRepo.count({
        where: { product_variant: { id: productVariant.id }, active: true, exit_date: IsNull() },
      });
    }
    const row = await this.movementRepo
      .createQueryBuilder('m')
      .select(
        `SUM(CASE WHEN m.movement_type IN ('ENTRY','RETURN') THEN m.quantity ` +
          `WHEN m.movement_type IN ('EXIT','SALE','WARRANTY') THEN -m.quantity ELSE 0 END)`,
        'qty',
      )
      .where('m.product_variant_id = :id', { id: productVariant.id })
      .getRawOne();
    return Number(row?.qty) || 0;
  }

  async updateProduct(id: string, dto: UpdateProductDto): Promise<Product> {
    const entity = await this.productRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Product ${id} not found`);

    if (dto.categoryId !== undefined) {
      const category = await this.categoryRepo.findOne({ where: { id: dto.categoryId } });
      if (!category) throw new NotFoundException(`Category ${dto.categoryId} not found`);
      entity.category = category;
    }

    const priceChanged = dto.salePrice !== undefined && dto.salePrice !== entity.sale_price;
    const nameChanged = dto.name !== undefined && dto.name !== entity.name;

    Object.assign(entity, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.active !== undefined && { active: dto.active }),
      ...(dto.hasIdentifier !== undefined && { has_identifier: dto.hasIdentifier }),
      ...(dto.negativeSell !== undefined && { negative_sell: dto.negativeSell }),
      ...(dto.salePrice !== undefined && { sale_price: dto.salePrice }),
    });
    const saved = await this.productRepo.save(entity);

    // Best-effort pushes: never throw (a temporary Alegra outage must not block saving the local
    // change), but surface what failed instead of hiding it — the caller was explicit that a
    // silent local-only save was misleading the user into thinking Alegra was already up to date.
    const warnings: string[] = [];
    if (priceChanged) {
      const warning = await this.pushPriceToAlegra(saved);
      if (warning) warnings.push(warning);
    }
    if (nameChanged) {
      const warning = await this.pushNameToAlegra(saved);
      if (warning) warnings.push(warning);
    }

    return warnings.length ? Object.assign(saved, { alegraSyncWarning: warnings.join(' — ') }) : saved;
  }

  /**
   * Best-effort: pushes the product's sale price to every Alegra item already published for it
   * (one per warehouse). Never throws — a temporary Alegra outage must not block saving the local
   * price, it just means that warehouse's item is stale until the next successful push/retry.
   * Returns a human-readable warning listing which warehouses failed, or null if all succeeded.
   */
  private async pushPriceToAlegra(product: Product): Promise<string | null> {
    const mappings = await this.pwaiRepo.find({ where: { product_id: product.id } });
    const failedStores: string[] = [];
    for (const mapping of mappings) {
      try {
        await this.alegraSync.updateItemInAlegra(mapping.store_key, mapping.alegra_item_id, {
          price: product.sale_price ?? 0,
        });
      } catch (err: any) {
        this.logger.warn(
          `[updateProduct] Failed to push price to Alegra item ${mapping.alegra_item_id} (product ${product.id}): ${err?.message}`,
        );
        failedStores.push(mapping.store_key);
      }
    }
    return failedStores.length
      ? `El precio se guardó localmente pero no se pudo actualizar en Alegra para: ${failedStores.join(', ')}`
      : null;
  }

  /**
   * Best-effort: pushes the product's new name to every Alegra item already published for it.
   * Each warehouse's Alegra item name carries that warehouse's prefix (see
   * `ProductAlegraPublishService.buildAlegraItemName`, e.g. "(P) iPhone 17 Pro" for a non-main
   * warehouse) — recomputed per mapping's warehouse, not just the raw product name, so a rename
   * doesn't wipe out the prefix that distinguishes the same product across warehouses in Alegra.
   * Returns a human-readable warning listing which warehouses failed, or null if all succeeded.
   */
  private async pushNameToAlegra(product: Product): Promise<string | null> {
    const mappings = await this.pwaiRepo.find({ where: { product_id: product.id } });
    const failedStores: string[] = [];
    for (const mapping of mappings) {
      try {
        const warehouse = await this.warehouseRepo.findOne({ where: { id: mapping.warehouse_id } });
        if (!warehouse) continue;
        const name = this.alegraPublishService.buildAlegraItemName(warehouse, product);
        await this.alegraSync.updateItemInAlegra(mapping.store_key, mapping.alegra_item_id, { name });
        mapping.alegra_name = name;
        await this.pwaiRepo.save(mapping);
      } catch (err: any) {
        this.logger.warn(
          `[updateProduct] Failed to push name to Alegra item ${mapping.alegra_item_id} (product ${product.id}): ${err?.message}`,
        );
        failedStores.push(mapping.store_key);
      }
    }
    return failedStores.length
      ? `El nombre se guardó localmente pero no se pudo actualizar en Alegra para: ${failedStores.join(', ')}`
      : null;
  }

  /**
   * Borrado seguro: si CUALQUIERA de sus variantes tiene existencias, se rechaza (no hay borrado
   * silencioso de stock). Si pasa la validación, se borra el producto — cascade se encarga de
   * `ProductVariant` (y de `Variant`/`ProductWarehouseAlegraItem` transitivamente vía FKs
   * `onDelete: 'CASCADE'`).
   */
  async deleteProduct(id: string): Promise<{ deleted: true }> {
    const product = await this.productRepo.findOne({ where: { id }, relations: ['variants'] });
    if (!product) throw new NotFoundException(`Product ${id} not found`);

    const variantsWithStock: string[] = [];
    for (const pv of product.variants ?? []) {
      const stock = await this.getProductVariantTotalStock({ ...pv, product });
      if (stock > 0) variantsWithStock.push(pv.sku);
    }
    if (variantsWithStock.length) {
      throw new BadRequestException(
        `No se puede eliminar el producto "${product.name}": las siguientes variantes tienen ` +
          `existencias: ${variantsWithStock.join(', ')}. Desactivalas en su lugar.`,
      );
    }

    await this.productRepo.remove(product);
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Product variants (color + sku)
  // -------------------------------------------------------------------------

  findProductVariants(productId: string): Promise<ProductVariant[]> {
    return this.productVariantRepo.find({
      where: { product: { id: productId } },
      relations: ['color'],
      order: { created_at: 'ASC' },
    });
  }

  /**
   * Resolves variants by id regardless of pagination/active-status filters used elsewhere
   * (e.g. `findProductsForWarehouse`) — used to redisplay a purchase order draft's saved
   * `productVariantId` even if that variant fell outside the warehouse's product page or was
   * later deactivated.
   */
  async findVariantsByIds(ids: string[]): Promise<
    Array<{ id: string; sku: string; color: ColorSummary | null; productId: string; productName: string }>
  > {
    if (!ids.length) return [];
    const variants = await this.productVariantRepo.find({
      where: { id: In(ids) },
      relations: ['color', 'product'],
    });
    return variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      color: toColorSummary(v.color),
      productId: v.product.id,
      productName: v.product.name,
    }));
  }

  async findProductVariantById(id: string): Promise<ProductVariant> {
    const entity = await this.productVariantRepo.findOne({
      where: { id },
      relations: ['product', 'color'],
    });
    if (!entity) throw new NotFoundException(`ProductVariant ${id} not found`);
    return entity;
  }

  async createProductVariant(productId: string, dto: CreateProductVariantDto): Promise<ProductVariant> {
    if ((!dto.color?.trim() && !dto.colorId?.trim()) || !dto.sku?.trim()) {
      throw new BadRequestException('A color (or colorId) and sku are required');
    }
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);

    const sku = dto.sku.trim();
    const existing = await this.productVariantRepo.findOne({ where: { sku } });
    if (existing) throw new ConflictException(`SKU '${sku}' already in use`);

    const color = await this.resolveColorInput(dto);

    const entity = this.productVariantRepo.create({
      product,
      color,
      sku,
    });
    return this.productVariantRepo.save(entity);
  }

  async updateProductVariant(id: string, dto: UpdateProductVariantDto): Promise<ProductVariant> {
    const entity = await this.productVariantRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`ProductVariant ${id} not found`);

    if (dto.sku !== undefined && dto.sku.trim() && dto.sku.trim() !== entity.sku) {
      const conflict = await this.productVariantRepo.findOne({ where: { sku: dto.sku.trim() } });
      if (conflict) throw new ConflictException(`SKU '${dto.sku}' already in use`);
    }

    if (dto.colorId !== undefined || dto.color !== undefined) {
      entity.color = await this.resolveColorInput(dto);
    }

    Object.assign(entity, {
      ...(dto.sku !== undefined && { sku: dto.sku.trim() }),
      ...(dto.active !== undefined && { active: dto.active }),
    });
    await this.productVariantRepo.save(entity);
    return this.findProductVariantById(entity.id);
  }

  /**
   * Borrado seguro: rechaza si la variante tiene existencias (en cualquier bodega) o si es la
   * única variante del producto — por diseño todo producto debe tener siempre al menos una.
   */
  async deleteProductVariant(id: string): Promise<{ deleted: true }> {
    const entity = await this.productVariantRepo.findOne({ where: { id }, relations: ['product'] });
    if (!entity) throw new NotFoundException(`ProductVariant ${id} not found`);

    const totalStock = await this.getProductVariantTotalStock(entity);
    if (totalStock > 0) {
      throw new BadRequestException(
        `No se puede eliminar una variante con existencias (SKU '${entity.sku}', ${totalStock} en stock). ` +
          `Desactivala en su lugar.`,
      );
    }

    const totalVariants = await this.productVariantRepo.count({
      where: { product: { id: entity.product.id } },
    });
    if (totalVariants <= 1) {
      throw new BadRequestException('Un producto debe tener al menos una variante');
    }

    await this.productVariantRepo.remove(entity);
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Variants (unidades físicas — solo para productos con has_identifier=true)
  // -------------------------------------------------------------------------

  findVariantsByProduct(productVariantId: string): Promise<Variant[]> {
    return this.variantRepo.find({
      where: { product_variant: { id: productVariantId } },
      relations: ['product_variant', 'product_variant.product', 'warehouse'],
      order: { created_at: 'ASC' },
    });
  }

  async findVariantById(id: string): Promise<Variant> {
    const entity = await this.variantRepo.findOne({
      where: { id },
      relations: ['product_variant', 'product_variant.product', 'warehouse'],
    });
    if (!entity) throw new NotFoundException(`Variant ${id} not found`);
    return entity;
  }

  async createVariant(productVariantId: string, dto: CreateVariantDto): Promise<Variant> {
    const productVariant = await this.productVariantRepo.findOne({ where: { id: productVariantId } });
    if (!productVariant) throw new NotFoundException(`ProductVariant ${productVariantId} not found`);

    const warehouse = dto.warehouseId
      ? await this.warehouseRepo.findOne({ where: { id: dto.warehouseId } })
      : null;

    const variant = this.variantRepo.create({
      product_variant: productVariant,
      warehouse,
      barcode: dto.barcode ?? null,
      identifier: dto.identifier?.trim() ?? null,
      entry_date: dto.entryDate ?? new Date(),
    });
    return this.variantRepo.save(variant);
  }

  async updateVariant(id: string, dto: UpdateVariantDto): Promise<Variant> {
    const entity = await this.variantRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Variant ${id} not found`);

    if (dto.warehouseId !== undefined) {
      entity.warehouse = dto.warehouseId
        ? await this.warehouseRepo.findOne({ where: { id: dto.warehouseId } })
        : null;
    }

    Object.assign(entity, {
      ...(dto.barcode !== undefined && { barcode: dto.barcode }),
      ...(dto.identifier !== undefined && { identifier: dto.identifier }),
      ...(dto.entryDate !== undefined && { entry_date: dto.entryDate }),
      ...(dto.exitDate !== undefined && { exit_date: dto.exitDate }),
      ...(dto.active !== undefined && { active: dto.active }),
      ...(dto.salePrice !== undefined && { sale_price: dto.salePrice }),
    });
    await this.variantRepo.save(entity);
    return this.findVariantById(entity.id);
  }

  // -------------------------------------------------------------------------
  // Stores
  // -------------------------------------------------------------------------

  findAllStores(): Promise<Store[]> {
    return this.storeRepo.find({ relations: ['warehouses'], order: { name: 'ASC' } });
  }

  findStoreByStoreKey(storeKey: string): Promise<Store | null> {
    return this.storeRepo.findOne({ where: { store_key: storeKey.toLowerCase() } });
  }

  findStoreById(id: string): Promise<Store | null> {
    return this.storeRepo.findOne({ where: { id } });
  }

  // -------------------------------------------------------------------------
  // Warehouses
  // -------------------------------------------------------------------------

  findWarehousesByStoreId(storeId: string): Promise<Warehouse[]> {
    return this.warehouseRepo.find({
      where: { store: { id: storeId } },
      order: { created_at: 'ASC' },
    });
  }

  findMainWarehouse(storeId: string): Promise<Warehouse | null> {
    return this.warehouseRepo.findOne({
      where: { store: { id: storeId }, is_main: true },
    });
  }

  async createWarehouse(storeId: string, dto: CreateWarehouseDto): Promise<Warehouse> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Warehouse name is required');
    }
    const store = await this.storeRepo.findOne({ where: { id: storeId } });
    if (!store) throw new NotFoundException(`Store ${storeId} not found`);

    const entity = this.warehouseRepo.create({
      store,
      name: dto.name.trim(),
      is_main: dto.isMain ?? false,
      // Main warehouses carry no prefix by convention.
      prefix: dto.isMain ? null : dto.prefix?.trim() || null,
      alegra_warehouse_id: dto.alegraWarehouseId ?? null,
      alegra_store_key: dto.alegraStoreKey ?? null,
    });
    return this.warehouseRepo.save(entity);
  }

  async syncWarehousesFromAlegra(storeKey: string): Promise<Warehouse[]> {
    const store = await this.storeRepo.findOne({ where: { store_key: storeKey.toLowerCase() } });
    if (!store) throw new NotFoundException(`Store '${storeKey}' not found`);

    const client = this.alegraFactory.getClient(storeKey);
    const res = await this.alegraFactory.requestWithRetry(() => client.get('/warehouses'));
    // Alegra returns `id` as a string (e.g. "1") and may flag the default warehouse via `isDefault`.
    const alegraWarehouses: Array<{
      id: string | number;
      name: string;
      status?: string;
      isDefault?: boolean;
    }> = res.data ?? [];

    const existing = await this.warehouseRepo.find({
      where: { store: { id: store.id } },
    });
    // Key the dedup map by number — the DB column is integer, but Alegra sends a string id.
    const existingByAlegraId = new Map(
      existing
        .filter((w) => w.alegra_warehouse_id != null)
        .map((w) => [Number(w.alegra_warehouse_id), w]),
    );

    const results: Warehouse[] = [];
    for (const aw of alegraWarehouses) {
      const alegraId = Number(aw.id);
      if (Number.isNaN(alegraId)) {
        this.logger.warn(`[syncWarehouses] Skipping Alegra warehouse with non-numeric id: ${aw.id}`);
        continue;
      }
      const isActive = !aw.status || aw.status === 'active';
      const found = existingByAlegraId.get(alegraId);
      if (found) {
        found.name = aw.name;
        found.active = isActive;
        found.alegra_store_key = storeKey;
        results.push(await this.warehouseRepo.save(found));
      } else {
        const created = this.warehouseRepo.create({
          store,
          name: aw.name,
          active: isActive,
          is_main: aw.isDefault ?? false,
          alegra_warehouse_id: alegraId,
          alegra_store_key: storeKey,
        });
        results.push(await this.warehouseRepo.save(created));
      }
    }

    return results;
  }

  async updateWarehouse(id: string, dto: UpdateWarehouseDto): Promise<Warehouse> {
    const entity = await this.warehouseRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Warehouse ${id} not found`);
    Object.assign(entity, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.isMain !== undefined && { is_main: dto.isMain }),
      ...(dto.active !== undefined && { active: dto.active }),
      ...(dto.prefix !== undefined && { prefix: dto.prefix?.trim() || null }),
      ...(dto.alegraWarehouseId !== undefined && { alegra_warehouse_id: dto.alegraWarehouseId }),
      ...(dto.alegraStoreKey !== undefined && { alegra_store_key: dto.alegraStoreKey }),
    });
    return this.warehouseRepo.save(entity);
  }

  // -------------------------------------------------------------------------
  // Units by store (inventory view) — productos con has_identifier=true
  // -------------------------------------------------------------------------

  async findUnitsByStore(filters: {
    storeId: string;
    categoryId?: string;
    search?: string;
    identifier?: string;
  }): Promise<Variant[]> {
    const qb = this.variantRepo
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.product_variant', 'pv')
      .leftJoinAndSelect('pv.color', 'pvColor')
      .leftJoinAndSelect('pv.product', 'product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('v.warehouse', 'warehouse')
      .innerJoin('warehouse.store', 'store')
      .where('store.id = :storeId', { storeId: filters.storeId })
      .andWhere('v.active = true')
      .andWhere('v.exit_date IS NULL');

    if (filters.categoryId) {
      qb.andWhere('category.id = :categoryId', { categoryId: filters.categoryId });
    }
    // Single search term matches product name, variant sku and the unit identifier.
    const rawTerm = filters.search ?? filters.identifier;
    if (rawTerm) {
      const term = `%${rawTerm}%`;
      qb.andWhere('(product.name ILIKE :term OR pv.sku ILIKE :term OR v.identifier ILIKE :term)', { term });
    }

    return qb.orderBy('product.name', 'ASC').addOrderBy('v.identifier', 'ASC').getMany();
  }

  /**
   * Stock por cantidad para productos con has_identifier=false en una sede: se calcula
   * sumando InventoryMovement (entradas - salidas) agrupado por ProductVariant.
   */
  async findFungibleStockByStore(filters: {
    storeId: string;
    categoryId?: string;
    search?: string;
  }): Promise<Array<{ product: any; variant: any; quantity: number }>> {
    const qb = this.movementRepo
      .createQueryBuilder('m')
      .innerJoin('m.product_variant', 'pv')
      .innerJoin('pv.color', 'color')
      .innerJoin('pv.product', 'product')
      .innerJoin('product.category', 'category')
      .select('product.id', 'productId')
      .addSelect('product.name', 'productName')
      .addSelect('category.id', 'categoryId')
      .addSelect('category.name', 'categoryName')
      .addSelect('pv.id', 'variantId')
      .addSelect('pv.sku', 'variantSku')
      .addSelect('color.id', 'colorId')
      .addSelect('color.name', 'colorName')
      .addSelect('color.hex_code', 'colorHexCode')
      .addSelect('product.sale_price', 'salePrice')
      .addSelect(
        `SUM(CASE WHEN m.movement_type IN ('ENTRY','RETURN') THEN m.quantity ` +
          `WHEN m.movement_type IN ('EXIT','SALE','WARRANTY') THEN -m.quantity ELSE 0 END)`,
        'quantity',
      )
      .where('product.store_id = :storeId', { storeId: filters.storeId })
      .andWhere('product.has_identifier = false')
      .groupBy('product.id')
      .addGroupBy('category.id')
      .addGroupBy('pv.id')
      .addGroupBy('color.id');

    if (filters.categoryId) {
      qb.andWhere('category.id = :categoryId', { categoryId: filters.categoryId });
    }
    if (filters.search) {
      qb.andWhere('(product.name ILIKE :term OR pv.sku ILIKE :term)', {
        term: `%${filters.search}%`,
      });
    }

    const rows = await qb.orderBy('product.name', 'ASC').getRawMany();
    return rows
      .map((r) => ({
        product: {
          id: r.productId,
          name: r.productName,
          category: { id: r.categoryId, name: r.categoryName },
          sale_price: r.salePrice == null ? null : Number(r.salePrice),
        },
        variant: {
          id: r.variantId,
          sku: r.variantSku,
          color: { id: r.colorId, name: r.colorName, hexCode: r.colorHexCode },
        },
        quantity: Number(r.quantity) || 0,
      }))
      .filter((r) => r.quantity !== 0);
  }

  // -------------------------------------------------------------------------
  // Resolve product config for Alegra items (drives the purchase-order form)
  // -------------------------------------------------------------------------

  async resolveItemsConfig(
    store: string,
    alegraItemIds: number[],
  ): Promise<
    Record<string, { mapped: boolean; hasIdentifier: boolean; productName?: string }>
  > {
    const result: Record<string, { mapped: boolean; hasIdentifier: boolean; productName?: string }> = {};

    for (const alegraItemId of alegraItemIds) {
      const mapping = await this.pwaiRepo.findOne({
        where: { store_key: store.toLowerCase(), alegra_item_id: alegraItemId },
        relations: ['product'],
      });

      if (!mapping?.product) {
        result[alegraItemId] = { mapped: false, hasIdentifier: true };
        continue;
      }

      result[alegraItemId] = {
        mapped: true,
        hasIdentifier: mapping.product.has_identifier ?? true,
        productName: mapping.product.name,
      };
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Alegra contacts cache (providers / clients)
  // -------------------------------------------------------------------------

  /**
   * Pulls contacts for a store from Alegra and upserts them locally.
   * IMPORTANT: Alegra's `type` array in the unfiltered list is unreliable — the authoritative
   * classification is the `?type=` FILTER. So we fetch providers and clients separately and merge.
   */
  async syncContactsFromAlegra(
    storeKey: string,
    opts?: { full?: boolean },
  ): Promise<{ synced: number; mode: 'full' | 'incremental' }> {
    const client = this.alegraFactory.getClient(storeKey);
    const key = storeKey.toLowerCase();

    const existing = await this.contactRepo.find({ where: { store_key: key } });
    const byAlegraId = new Map(existing.map((c) => [c.alegra_id, c]));
    const maxLocalId = existing.reduce((m, c) => Math.max(m, Number(c.alegra_id) || 0), 0);
    // Incremental: if the store already has contacts, only pull the ones created after our newest id.
    const incremental = !opts?.full && existing.length > 0 && maxLocalId > 0;
    const mode: 'full' | 'incremental' = incremental ? 'incremental' : 'full';
    this.logger.log(
      `[syncContacts] ${key}: iniciando (${mode}${incremental ? `, desde id ${maxLocalId}` : ''})...`,
    );

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // One page with escalating backoff retry — Alegra rate-limits (429/400) under sustained load.
    const fetchPage = async (params: Record<string, any>): Promise<any[] | null> => {
      for (let attempt = 0; attempt <= 6; attempt++) {
        try {
          const r = await client.get('/contacts', { params });
          return Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
        } catch (err: any) {
          const st = err?.response?.status;
          if ((st === 429 || st === 400 || st === 503 || !st) && attempt < 6) {
            await sleep(Math.min(2000 * 2 ** attempt, 30000)); // 2,4,8,16,30,30s
            continue;
          }
          this.logger.warn(`[syncContacts] ${key}: página falló (status ${st ?? err?.message})`);
          return null;
        }
      }
      return null;
    };

    // Total reported by Alegra (metadata) so a full sync knows its target and doesn't stop early.
    const getTotal = async (type: string): Promise<number> => {
      try {
        const r = await client.get('/contacts', { params: { type, limit: 1, metadata: true } });
        return Number(r.data?.metadata?.total) || 0;
      } catch {
        return 0;
      }
    };

    const fetchByType = async (type: 'provider' | 'client'): Promise<any[]> => {
      const PAGE = 30;
      const BATCH = 2;
      const HARD_CAP = 60000;
      const out: any[] = [];

      // FULL: paginate by id ASC (stable, complete) up to the reported total.
      // INCREMENTAL: paginate by id DESC and stop as soon as we reach an id we already have.
      const total = incremental ? Infinity : await getTotal(type);
      if (!incremental) this.logger.log(`[syncContacts] ${key}/${type}: total en Alegra = ${total}`);

      let base = 0;
      let done = false;
      while (!done && out.length < HARD_CAP) {
        // Stop paginating once we've clearly passed the reported total.
        if (!incremental && total > 0 && base >= total + PAGE) break;

        const starts = Array.from({ length: BATCH }, (_, i) => base + i * PAGE);
        const pages = await Promise.all(
          starts.map((s) =>
            fetchPage({
              type,
              order_field: 'id',
              order_direction: incremental ? 'DESC' : 'ASC',
              start: s,
              limit: PAGE,
            }),
          ),
        );
        for (const page of pages) {
          if (page === null) {
            // Full: skip this gap and keep going (don't lose the rest). Incremental: stop.
            if (incremental) { done = true; break; }
            this.logger.warn(`[syncContacts] ${key}/${type}: página omitida (gap), continúa`);
            continue;
          }
          if (page.length === 0) { done = true; break; } // reached the end
          if (incremental) {
            const fresh = page.filter((c) => Number(c.id) > maxLocalId);
            out.push(...fresh);
            if (fresh.length < page.length) { done = true; break; } // reached known ids
            if (page.length < PAGE) { done = true; break; }
          } else {
            out.push(...page);
          }
        }
        this.logger.log(
          `[syncContacts] ${key}/${type}: ${out.length}${!incremental && total ? '/' + total : ''} ${incremental ? 'nuevos' : 'traídos'}...`,
        );
        base += BATCH * PAGE;
      }
      return out;
    };

    // Sequential (not Promise.all) to halve the peak request rate on Alegra.
    const providers = await fetchByType('provider');
    const clients = await fetchByType('client');

    // Merge by Alegra id — a contact can be both provider and client.
    const merged = new Map<string, { c: any; isProvider: boolean; isClient: boolean }>();
    for (const c of providers) merged.set(String(c.id), { c, isProvider: true, isClient: false });
    for (const c of clients) {
      const e = merged.get(String(c.id));
      if (e) e.isClient = true;
      else merged.set(String(c.id), { c, isProvider: false, isClient: true });
    }

    const store = await this.storeRepo.findOne({ where: { store_key: key } });

    const toSave: Contact[] = [];
    for (const [alegraId, { c, isProvider, isClient }] of merged) {
      const entity =
        byAlegraId.get(alegraId) ?? this.contactRepo.create({ store_key: key, alegra_id: alegraId });
      entity.store = store ?? null;
      entity.name = c.name ?? '';
      entity.identification = c.identification ?? null;
      entity.email = c.email ?? null;
      entity.phone = c.phonePrimary || c.phoneSecondary || null;
      entity.mobile = c.mobile ?? null;
      entity.is_provider = isProvider;
      entity.is_client = isClient;
      entity.status = c.status ?? null;
      entity.active = !c.status || c.status === 'active';
      entity.address = c.address ?? null;
      entity.raw = c; // full Alegra payload
      toSave.push(entity);
    }

    await this.contactRepo.save(toSave, { chunk: 200 });
    this.logger.log(
      `[syncContacts] ${key}: listo (${mode}) — ${toSave.length} guardados (${providers.length} prov, ${clients.length} cli)`,
    );
    return { synced: toSave.length, mode };
  }

  /** Paginated contact list for the management screen. Excludes the heavy `raw` JSONB. */
  async findContactsForManage(filters: {
    storeId?: string;
    type?: 'client' | 'provider';
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number }> {
    const take = Math.min(filters.limit ?? 25, 200);
    const skip = (filters.page ?? 0) * take;

    const applyFilters = (qb: any) => {
      if (filters.storeId) qb.andWhere('store.id = :storeId', { storeId: filters.storeId });
      if (filters.type === 'provider') qb.andWhere('c.is_provider = true');
      if (filters.type === 'client') qb.andWhere('c.is_client = true');
      if (filters.search) {
        qb.andWhere('(c.name ILIKE :t OR c.identification ILIKE :t)', { t: `%${filters.search}%` });
      }
      return qb;
    };

    const total = await applyFilters(
      this.contactRepo.createQueryBuilder('c').leftJoin('c.store', 'store'),
    ).getCount();

    // getRawMany avoids TypeORM's entity-pagination ORDER BY parser, which chokes on the comma
    // inside REGEXP_REPLACE. Clean alphabetical: case-insensitive, ignoring leading spaces/punct.
    const rows = await applyFilters(
      this.contactRepo
        .createQueryBuilder('c')
        .leftJoin('c.store', 'store')
        .select('c.id', 'id')
        .addSelect('c.alegra_id', 'alegra_id')
        .addSelect('c.name', 'name')
        .addSelect('c.identification', 'identification')
        .addSelect('c.email', 'email')
        .addSelect('c.phone', 'phone')
        .addSelect('c.mobile', 'mobile')
        .addSelect('c.is_provider', 'is_provider')
        .addSelect('c.is_client', 'is_client')
        .addSelect('c.active', 'active')
        .addSelect('c.address', 'address')
        .addSelect('store.id', 'store_id')
        .addSelect('store.name', 'store_name'),
    )
      .orderBy("LOWER(REGEXP_REPLACE(TRIM(c.name), '^[^[:alnum:]]+', ''))", 'ASC')
      .offset(skip)
      .limit(take)
      .getRawMany();

    const data = rows.map((r: any) => ({
      id: r.id,
      alegra_id: r.alegra_id,
      name: r.name,
      identification: r.identification,
      email: r.email,
      phone: r.phone,
      mobile: r.mobile,
      is_provider: r.is_provider,
      is_client: r.is_client,
      active: r.active,
      address: r.address,
      store: r.store_id ? { id: r.store_id, name: r.store_name } : null,
    }));

    return { data, total };
  }

  /** Edits a contact in Alegra (source of truth) and mirrors the change locally. */
  async updateContact(
    id: string,
    dto: {
      name?: string;
      identification?: string;
      email?: string;
      phone?: string;
      mobile?: string;
      address?: {
        address?: string | null;
        city?: string | null;
        department?: string | null;
        country?: string | null;
        zipCode?: string | null;
      };
    },
  ): Promise<Contact> {
    const contact = await this.contactRepo.findOne({ where: { id }, relations: ['store'] });
    if (!contact) throw new NotFoundException(`Contact ${id} not found`);

    const client = this.alegraFactory.getClient(contact.store_key);
    const payload: Record<string, any> = {};
    if (dto.name !== undefined) payload.name = dto.name;
    if (dto.identification !== undefined) payload.identification = dto.identification;
    if (dto.email !== undefined) payload.email = dto.email;
    if (dto.phone !== undefined) payload.phonePrimary = dto.phone;
    if (dto.mobile !== undefined) payload.mobile = dto.mobile;
    if (dto.address !== undefined) {
      // Merge onto the existing address so untouched fields are preserved.
      payload.address = { ...(contact.address ?? {}), ...dto.address };
    }

    let updated: any;
    try {
      const res = await this.alegraFactory.requestWithRetry(() =>
        client.put(`/contacts/${contact.alegra_id}`, payload),
      );
      updated = res.data;
    } catch (err: any) {
      const body = err.response?.data;
      throw new BadRequestException(
        body?.message ?? err.message ?? 'Error al actualizar el contacto en Alegra',
      );
    }

    contact.name = updated.name ?? contact.name;
    contact.identification = updated.identification ?? contact.identification;
    contact.email = updated.email ?? null;
    contact.phone = updated.phonePrimary ?? updated.phoneSecondary ?? null;
    contact.mobile = updated.mobile ?? null;
    contact.address = updated.address ?? contact.address;
    contact.raw = updated;
    return this.contactRepo.save(contact);
  }

  /** Syncs contacts from Alegra for every store (sede). Per-store failures don't abort the rest. */
  async syncAllContactsFromAlegra(opts?: { full?: boolean }): Promise<{
    total: number;
    perStore: Array<{ store: string; synced: number; error?: string }>;
  }> {
    const stores = await this.storeRepo.find({ order: { name: 'ASC' } });
    const perStore: Array<{ store: string; synced: number; error?: string }> = [];
    let total = 0;

    for (const store of stores) {
      try {
        const { synced } = await this.syncContactsFromAlegra(store.store_key, { full: opts?.full });
        total += synced;
        perStore.push({ store: store.store_key, synced });
      } catch (err: any) {
        this.logger.error(
          `[syncAllContacts] Failed for store ${store.store_key}: ${err?.message}`,
        );
        perStore.push({ store: store.store_key, synced: 0, error: err?.message ?? 'error' });
      }
    }

    return { total, perStore };
  }

  /**
   * Reads contacts from the local cache. Lazily syncs from Alegra if the store has none yet.
   * Returns an Alegra-compatible shape (`id` = Alegra contact id) so callers use the same field.
   */
  async findContacts(filters: {
    store: string;
    type?: 'provider' | 'client';
    search?: string;
  }): Promise<Array<{ id: string; name: string; identification: string | null; email: string | null; phone: string | null }>> {
    const key = filters.store.toLowerCase();

    const count = await this.contactRepo.count({ where: { store_key: key } });
    if (count === 0) {
      await this.syncContactsFromAlegra(key);
    }

    const qb = this.contactRepo
      .createQueryBuilder('c')
      .where('c.store_key = :key', { key })
      .andWhere('c.active = true');

    if (filters.type === 'provider') qb.andWhere('c.is_provider = true');
    if (filters.type === 'client') qb.andWhere('c.is_client = true');
    if (filters.search) {
      qb.andWhere('(c.name ILIKE :term OR c.identification ILIKE :term)', {
        term: `%${filters.search}%`,
      });
    }

    const rows = await qb.orderBy('c.name', 'ASC').take(200).getMany();
    return rows.map((c) => ({
      id: c.alegra_id,
      name: c.name,
      identification: c.identification,
      email: c.email,
      phone: c.mobile || c.phone,
    }));
  }
}
