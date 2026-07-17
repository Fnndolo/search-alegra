import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Logger,
  HttpException,
  HttpStatus,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../entities/user.entity';

import { InventoryService } from './services/inventory.service';
import { ColorService } from './services/color.service';
import { InventoryStockService } from './services/inventory-stock.service';
import {
  InventoryIngresoService,
  IngresoUnidadesDto,
} from './services/inventory-ingreso.service';
import {
  InventorySyncConfigService,
  UpdateSyncConfigDto,
} from './services/inventory-sync-config.service';
import { InventoryStatsService } from './services/inventory-stats.service';
import { ProductAlegraPublishService } from './services/product-alegra-publish.service';
import { InventoryAlegraFactory } from './alegra/inventory-alegra.factory';
import { AlegraImportService } from './services/alegra-import.service';

function rethrow(err: unknown, logger: Logger, context: string): never {
  if (err instanceof HttpException) throw err;
  const msg = (err as any)?.message ?? 'Internal server error';
  logger.error(`[InventoryController] ${context}: ${msg}`, (err as any)?.stack);
  throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
}

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.FACTURACION)
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly stockService: InventoryStockService,
    private readonly ingresoService: InventoryIngresoService,
    private readonly syncConfigService: InventorySyncConfigService,
    private readonly statsService: InventoryStatsService,
    private readonly publishService: ProductAlegraPublishService,
    private readonly alegraFactory: InventoryAlegraFactory,
    private readonly alegraImportService: AlegraImportService,
    private readonly colorService: ColorService,
  ) {}

  // ---------------------------------------------------------------------------
  // Colors
  // ---------------------------------------------------------------------------

  /**
   * GET /inventory/colors?search=<query>
   * `search` is optional: with it, filters by name (ILIKE, limit 20) for the autocomplete;
   * without it, returns the full palette (reused by the admin "manage colors" screen) — so this
   * single route covers both "search" and "get all", no separate route needed.
   */
  @Get('colors')
  async getColors(@Query('search') search?: string) {
    try {
      if (search?.trim()) {
        return await this.colorService.searchColors(search.trim());
      }
      return await this.colorService.listColors();
    } catch (err) {
      rethrow(err, this.logger, 'getColors');
    }
  }

  @Patch('colors/:id')
  async updateColor(
    @Param('id') id: string,
    @Body() body: { name?: string; hexCode?: string },
  ) {
    try {
      return await this.colorService.updateColor(id, body);
    } catch (err) {
      rethrow(err, this.logger, 'updateColor');
    }
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  @Get('stats')
  async getStats() {
    try {
      return await this.statsService.getStats();
    } catch (err) {
      rethrow(err, this.logger, 'getStats');
    }
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  @Get('categories')
  async getCategories() {
    try {
      return await this.inventoryService.findAllCategories();
    } catch (err) {
      rethrow(err, this.logger, 'getCategories');
    }
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  async createCategory(
    @Body()
    body: { name: string; description?: string },
  ) {
    try {
      return await this.inventoryService.createCategory(body);
    } catch (err) {
      rethrow(err, this.logger, 'createCategory');
    }
  }

  @Patch('categories/:id')
  async updateCategory(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      active?: boolean;
    },
  ) {
    try {
      return await this.inventoryService.updateCategory(id, body);
    } catch (err) {
      rethrow(err, this.logger, 'updateCategory');
    }
  }

  @Delete('categories/:id')
  async deleteCategory(@Param('id') id: string) {
    try {
      return await this.inventoryService.deleteCategory(id);
    } catch (err) {
      rethrow(err, this.logger, 'deleteCategory');
    }
  }

  // ---------------------------------------------------------------------------
  // Products
  // ---------------------------------------------------------------------------

  @Get('products')
  async getProducts(
    @Query('categoryId') categoryId?: string,
    @Query('storeId') storeId?: string,
    @Query('active') active?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: { categoryId?: string; storeId?: string; active?: boolean; search?: string; page?: number; limit?: number } = {};
      if (categoryId) filters.categoryId = categoryId;
      if (storeId) filters.storeId = storeId;
      if (active !== undefined) filters.active = active === 'true';
      if (search) filters.search = search;
      filters.page = page ? Number(page) : 0;
      filters.limit = limit ? Math.min(Number(limit), 100) : 50;
      return await this.inventoryService.findAllProducts(filters);
    } catch (err) {
      rethrow(err, this.logger, 'getProducts');
    }
  }

  @Get('products/:id')
  async getProductById(@Param('id') id: string) {
    try {
      return await this.inventoryService.findProductById(id);
    } catch (err) {
      rethrow(err, this.logger, 'getProductById');
    }
  }

  /** Ficha completa del producto: variantes con stock por bodega (+ unidades si es serializado). */
  @Get('products/:id/detail')
  async getProductDetail(@Param('id') id: string) {
    try {
      return await this.inventoryService.findProductDetail(id);
    } catch (err) {
      rethrow(err, this.logger, 'getProductDetail');
    }
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  async createProduct(
    @Body()
    body: {
      categoryId: string;
      storeId: string;
      name: string;
      hasIdentifier?: boolean;
      negativeSell?: boolean;
      salePrice?: number;
      variants: { color?: string; colorId?: string; sku: string }[];
    },
  ) {
    try {
      return await this.inventoryService.createProduct({
        categoryId: body.categoryId,
        storeId: body.storeId,
        name: body.name,
        hasIdentifier: body.hasIdentifier,
        negativeSell: body.negativeSell,
        salePrice: body.salePrice,
        variants: body.variants,
      });
    } catch (err) {
      rethrow(err, this.logger, 'createProduct');
    }
  }

  @Patch('products/:id')
  async updateProduct(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      categoryId?: string;
      active?: boolean;
      hasIdentifier?: boolean;
      negativeSell?: boolean;
      salePrice?: number;
    },
  ) {
    try {
      return await this.inventoryService.updateProduct(id, body);
    } catch (err) {
      rethrow(err, this.logger, 'updateProduct');
    }
  }

  @Delete('products/:id')
  async deleteProduct(@Param('id') id: string) {
    try {
      return await this.inventoryService.deleteProduct(id);
    } catch (err) {
      rethrow(err, this.logger, 'deleteProduct');
    }
  }

  // ---------------------------------------------------------------------------
  // Product variants (color + sku)
  // ---------------------------------------------------------------------------

  @Get('product-variants/by-ids')
  async getProductVariantsByIds(@Query('ids') ids?: string) {
    try {
      const list = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      return await this.inventoryService.findVariantsByIds(list);
    } catch (err) {
      rethrow(err, this.logger, 'getProductVariantsByIds');
    }
  }

  @Get('products/:productId/variants')
  async getProductVariants(@Param('productId') productId: string) {
    try {
      return await this.inventoryService.findProductVariants(productId);
    } catch (err) {
      rethrow(err, this.logger, 'getProductVariants');
    }
  }

  @Post('products/:productId/variants')
  @HttpCode(HttpStatus.CREATED)
  async createProductVariant(
    @Param('productId') productId: string,
    @Body() body: { color?: string; colorId?: string; sku: string },
  ) {
    try {
      return await this.inventoryService.createProductVariant(productId, body);
    } catch (err) {
      rethrow(err, this.logger, 'createProductVariant');
    }
  }

  @Patch('product-variants/:id')
  async updateProductVariant(
    @Param('id') id: string,
    @Body() body: { color?: string; colorId?: string; sku?: string; active?: boolean },
  ) {
    try {
      return await this.inventoryService.updateProductVariant(id, body);
    } catch (err) {
      rethrow(err, this.logger, 'updateProductVariant');
    }
  }

  @Delete('product-variants/:id')
  async deleteProductVariant(@Param('id') id: string) {
    try {
      return await this.inventoryService.deleteProductVariant(id);
    } catch (err) {
      rethrow(err, this.logger, 'deleteProductVariant');
    }
  }

  // ---------------------------------------------------------------------------
  // Product publishing to Alegra (one item per warehouse, dentro de la sede del producto)
  // ---------------------------------------------------------------------------

  /** Publishes the product to the given warehouses (all must belong to the product's sede). */
  @Post('products/:id/publish')
  @HttpCode(HttpStatus.OK)
  async publishProduct(
    @Param('id') id: string,
    @Body() body: { warehouseIds: string[] },
  ) {
    try {
      const ids = Array.isArray(body?.warehouseIds)
        ? body.warehouseIds.filter((k) => typeof k === 'string' && k.trim())
        : [];
      if (!ids.length) {
        throw new HttpException('warehouseIds is required', HttpStatus.BAD_REQUEST);
      }
      return await this.publishService.publishProduct(id, ids);
    } catch (err) {
      rethrow(err, this.logger, 'publishProduct');
    }
  }

  /** Ensures the Alegra item exists for a SPECIFIC warehouse (purchase-order camino 2). */
  @Post('products/:id/create-in-warehouse')
  @HttpCode(HttpStatus.OK)
  async createProductInWarehouse(
    @Param('id') id: string,
    @Body() body: { warehouseId: string },
  ) {
    try {
      if (!body?.warehouseId?.trim()) {
        throw new HttpException('warehouseId is required', HttpStatus.BAD_REQUEST);
      }
      return await this.publishService.createItemInAlegra(id, body.warehouseId.trim());
    } catch (err) {
      rethrow(err, this.logger, 'createProductInWarehouse');
    }
  }

  @Get('products/:id/alegra-status')
  async getProductAlegraStatus(@Param('id') id: string) {
    try {
      return await this.publishService.getAlegraStatus(id);
    } catch (err) {
      rethrow(err, this.logger, 'getProductAlegraStatus');
    }
  }

  // ---------------------------------------------------------------------------
  // Variants (unidades físicas de una ProductVariant)
  // ---------------------------------------------------------------------------

  @Get('variants/:productVariantId')
  async getVariantsByProduct(@Param('productVariantId') productVariantId: string) {
    try {
      return await this.inventoryService.findVariantsByProduct(productVariantId);
    } catch (err) {
      rethrow(err, this.logger, 'getVariantsByProduct');
    }
  }

  @Get('variants/detail/:id')
  async getVariantById(@Param('id') id: string) {
    try {
      return await this.inventoryService.findVariantById(id);
    } catch (err) {
      rethrow(err, this.logger, 'getVariantById');
    }
  }

  @Post('variants')
  @HttpCode(HttpStatus.CREATED)
  async createVariant(
    @Body()
    body: {
      productVariantId: string;
      warehouseId?: string;
      barcode?: string;
      identifier?: string;
      entryDate?: string;
    },
  ) {
    try {
      return await this.inventoryService.createVariant(body.productVariantId, {
        warehouseId: body.warehouseId,
        barcode: body.barcode,
        identifier: body.identifier,
        entryDate: body.entryDate ? new Date(body.entryDate) : undefined,
      });
    } catch (err) {
      rethrow(err, this.logger, 'createVariant');
    }
  }

  @Patch('variants/:id')
  async updateVariant(
    @Param('id') id: string,
    @Body()
    body: {
      warehouseId?: string;
      barcode?: string;
      identifier?: string;
      entryDate?: string;
      exitDate?: string;
      active?: boolean;
      salePrice?: number;
    },
  ) {
    try {
      return await this.inventoryService.updateVariant(id, {
        warehouseId: body.warehouseId,
        barcode: body.barcode,
        identifier: body.identifier,
        entryDate: body.entryDate ? new Date(body.entryDate) : undefined,
        exitDate: body.exitDate ? new Date(body.exitDate) : undefined,
        active: body.active,
        salePrice: body.salePrice,
      });
    } catch (err) {
      rethrow(err, this.logger, 'updateVariant');
    }
  }

  // ---------------------------------------------------------------------------
  // Stores
  // ---------------------------------------------------------------------------

  @Get('stores')
  async getStores() {
    try {
      return await this.inventoryService.findAllStores();
    } catch (err) {
      rethrow(err, this.logger, 'getStores');
    }
  }

  // ---------------------------------------------------------------------------
  // Warehouses
  // ---------------------------------------------------------------------------

  @Post('stores/:storeKey/sync-warehouses')
  @HttpCode(HttpStatus.OK)
  async syncWarehousesFromAlegra(@Param('storeKey') storeKey: string) {
    try {
      return await this.inventoryService.syncWarehousesFromAlegra(storeKey);
    } catch (err) {
      rethrow(err, this.logger, 'syncWarehousesFromAlegra');
    }
  }

  @Get('stores/:storeKey/warehouses')
  async getWarehousesByStoreKey(@Param('storeKey') storeKey: string) {
    try {
      const store = await this.inventoryService.findStoreByStoreKey(storeKey);
      if (!store) {
        throw new HttpException(`Store '${storeKey}' not found`, HttpStatus.NOT_FOUND);
      }
      return await this.inventoryService.findWarehousesByStoreId(store.id);
    } catch (err) {
      rethrow(err, this.logger, 'getWarehousesByStoreKey');
    }
  }

  @Post('warehouses')
  @HttpCode(HttpStatus.CREATED)
  async createWarehouse(
    @Body()
    body: {
      storeId: string;
      name: string;
      isMain?: boolean;
      prefix?: string;
      alegraWarehouseId?: number;
      alegraStoreKey?: string;
    },
  ) {
    try {
      return await this.inventoryService.createWarehouse(body.storeId, {
        name: body.name,
        isMain: body.isMain,
        prefix: body.prefix,
        alegraWarehouseId: body.alegraWarehouseId,
        alegraStoreKey: body.alegraStoreKey,
      });
    } catch (err) {
      rethrow(err, this.logger, 'createWarehouse');
    }
  }

  @Patch('warehouses/:id')
  async updateWarehouse(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      isMain?: boolean;
      active?: boolean;
      prefix?: string | null;
      alegraWarehouseId?: number;
      alegraStoreKey?: string;
    },
  ) {
    try {
      return await this.inventoryService.updateWarehouse(id, body);
    } catch (err) {
      rethrow(err, this.logger, 'updateWarehouse');
    }
  }

  /**
   * Productos activos de la sede de esta bodega, con sus variantes de color y su estado en
   * Alegra PARA ESTA BODEGA (camino 1: ya tiene item creado / camino 2: falta crearlo).
   * Usado por el formulario de orden de compra (Fase 4) para elegir producto + variante.
   */
  @Get('warehouses/:warehouseId/products')
  async getProductsForWarehouse(
    @Param('warehouseId') warehouseId: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      return await this.inventoryService.findProductsForWarehouse(warehouseId, {
        search,
        page: page ? Number(page) : 0,
        limit: limit ? Math.min(Number(limit), 100) : 50,
      });
    } catch (err) {
      rethrow(err, this.logger, 'getProductsForWarehouse');
    }
  }

  // ---------------------------------------------------------------------------
  // Stock — unit entry
  // ---------------------------------------------------------------------------

  @Post('stock/entry-quantity')
  @HttpCode(HttpStatus.CREATED)
  async stockEntry(
    @Body()
    body: {
      variantId: string;
      warehouseId: string;
      quantity: number;
    },
  ) {
    try {
      return await this.stockService.ingresoStock(body.variantId, body.warehouseId, body.quantity);
    } catch (err) {
      rethrow(err, this.logger, 'stockEntry');
    }
  }

  // ---------------------------------------------------------------------------
  // Stock — query
  // ---------------------------------------------------------------------------

  @Get('stock/variant/:id')
  async getStockByVariant(@Param('id') id: string) {
    try {
      return await this.stockService.getStockByVariant(id);
    } catch (err) {
      rethrow(err, this.logger, 'getStockByVariant');
    }
  }

  @Get('stock/store/:storeId')
  async getStockByStore(@Param('storeId') storeId: string) {
    try {
      return await this.stockService.getStockByStore(storeId);
    } catch (err) {
      rethrow(err, this.logger, 'getStockByStore');
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk unit entry
  // ---------------------------------------------------------------------------

  @Post('products/:productId/unit-entry')
  async unitEntry(
    @Param('productId') productId: string,
    @Query('preview') previewParam: string,
    @Body() body: IngresoUnidadesDto,
  ) {
    try {
      const preview = previewParam === 'true';
      return await this.ingresoService.procesarIngreso(productId, body, preview);
    } catch (err) {
      rethrow(err, this.logger, 'unitEntry');
    }
  }

  @Get('units/search')
  async searchUnit(@Query('identifier') identifier?: string) {
    try {
      if (!identifier?.trim()) {
        throw new HttpException('identifier is required', HttpStatus.BAD_REQUEST);
      }

      const unit = await this.ingresoService.buscarUnidadPorIdentifier(identifier.trim());

      if (!unit) {
        throw new HttpException('Unit not found', HttpStatus.NOT_FOUND);
      }
      return unit;
    } catch (err) {
      rethrow(err, this.logger, 'searchUnit');
    }
  }

  @Get('units/by-store')
  async getUnitsByStore(
    @Query('storeId') storeId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
    @Query('identifier') identifier?: string,
  ) {
    try {
      if (!storeId?.trim()) {
        throw new HttpException('storeId is required', HttpStatus.BAD_REQUEST);
      }
      return await this.inventoryService.findUnitsByStore({
        storeId: storeId.trim(),
        categoryId: categoryId?.trim() || undefined,
        search: search?.trim() || undefined,
        identifier: identifier?.trim() || undefined,
      });
    } catch (err) {
      rethrow(err, this.logger, 'getUnitsByStore');
    }
  }

  @Get('stock/fungible-by-store')
  async getFungibleStockByStore(
    @Query('storeId') storeId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    try {
      if (!storeId?.trim()) {
        throw new HttpException('storeId is required', HttpStatus.BAD_REQUEST);
      }
      return await this.inventoryService.findFungibleStockByStore({
        storeId: storeId.trim(),
        categoryId: categoryId?.trim() || undefined,
        search: search?.trim() || undefined,
      });
    } catch (err) {
      rethrow(err, this.logger, 'getFungibleStockByStore');
    }
  }

  @Post('items/resolve-config')
  @HttpCode(HttpStatus.OK)
  async resolveItemsConfig(@Body() body: { store: string; alegraItemIds: number[] }) {
    try {
      if (!body?.store?.trim()) {
        throw new HttpException('store is required', HttpStatus.BAD_REQUEST);
      }
      const ids = Array.isArray(body.alegraItemIds)
        ? body.alegraItemIds.map((n) => Number(n)).filter((n) => !Number.isNaN(n))
        : [];
      return await this.inventoryService.resolveItemsConfig(body.store.trim(), ids);
    } catch (err) {
      rethrow(err, this.logger, 'resolveItemsConfig');
    }
  }

  // ---------------------------------------------------------------------------
  // Sync configuration
  // ---------------------------------------------------------------------------

  @Get('config/sync')
  async getSyncConfig() {
    try {
      return await this.syncConfigService.getFullConfig();
    } catch (err) {
      rethrow(err, this.logger, 'getSyncConfig');
    }
  }

  @Patch('config/sync')
  async updateSyncConfig(@Body() body: UpdateSyncConfigDto) {
    try {
      return await this.syncConfigService.updateConfig(body);
    } catch (err) {
      rethrow(err, this.logger, 'updateSyncConfig');
    }
  }

  // ---------------------------------------------------------------------------
  // Alegra proxy — contacts & items (for purchase order form)
  // ---------------------------------------------------------------------------

  @Get('alegra/contacts')
  async searchAlegraContacts(
    @Query('store') store: string,
    @Query('keywords') keywords: string,
    @Query('type') type?: string,
  ) {
    try {
      const client = this.alegraFactory.getClient(store);

      // With a keyword, one page of matches is enough.
      if (keywords) {
        const params: Record<string, any> = { keywords };
        if (type) params.type = type;
        const res = await this.alegraFactory.requestWithRetry(() =>
          client.get('/contacts', { params }),
        );
        return res.data;
      }

      // Without a keyword, Alegra caps pages at 30 — paginate to return the full list.
      const PAGE = 30;
      const MAX_ITEMS = 1000;
      const all: any[] = [];
      let start = 0;
      // eslint-disable-next-line no-constant-condition
      while (all.length < MAX_ITEMS) {
        const params: Record<string, any> = { start, limit: PAGE };
        if (type) params.type = type;
        const res = await this.alegraFactory.requestWithRetry(() =>
          client.get('/contacts', { params }),
        );
        const page = res.data;
        if (!Array.isArray(page) || page.length === 0) break;
        all.push(...page);
        if (page.length < PAGE) break;
        start += PAGE;
      }
      return all;
    } catch (err) {
      rethrow(err, this.logger, 'searchAlegraContacts');
    }
  }

  // ---------------------------------------------------------------------------
  // Contacts cache (providers / clients) — reads local, syncs from Alegra
  // ---------------------------------------------------------------------------

  @Get('contacts')
  async getContacts(
    @Query('store') store?: string,
    @Query('type') type?: 'provider' | 'client',
    @Query('search') search?: string,
  ) {
    try {
      if (!store?.trim()) {
        throw new HttpException('store is required', HttpStatus.BAD_REQUEST);
      }
      return await this.inventoryService.findContacts({
        store: store.trim(),
        type: type === 'provider' || type === 'client' ? type : undefined,
        search: search?.trim() || undefined,
      });
    } catch (err) {
      rethrow(err, this.logger, 'getContacts');
    }
  }

  @Post('stores/:storeKey/sync-contacts')
  @HttpCode(HttpStatus.OK)
  async syncContacts(
    @Param('storeKey') storeKey: string,
    @Query('full') full?: string,
  ) {
    try {
      return await this.inventoryService.syncContactsFromAlegra(storeKey, { full: full === 'true' });
    } catch (err) {
      rethrow(err, this.logger, 'syncContacts');
    }
  }

  @Post('contacts/sync-all')
  @HttpCode(HttpStatus.OK)
  async syncAllContacts(@Query('full') full?: string) {
    try {
      return await this.inventoryService.syncAllContactsFromAlegra({ full: full === 'true' });
    } catch (err) {
      rethrow(err, this.logger, 'syncAllContacts');
    }
  }

  @Get('contacts/manage')
  async getContactsForManage(
    @Query('storeId') storeId?: string,
    @Query('type') type?: 'client' | 'provider',
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      return await this.inventoryService.findContactsForManage({
        storeId: storeId?.trim() || undefined,
        type: type === 'client' || type === 'provider' ? type : undefined,
        search: search?.trim() || undefined,
        page: page ? Number(page) : 0,
        limit: limit ? Number(limit) : 25,
      });
    } catch (err) {
      rethrow(err, this.logger, 'getContactsForManage');
    }
  }

  @Patch('contacts/:id')
  async updateContact(
    @Param('id') id: string,
    @Body()
    body: {
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
  ) {
    try {
      return await this.inventoryService.updateContact(id, body);
    } catch (err) {
      rethrow(err, this.logger, 'updateContact');
    }
  }

  @Get('alegra/items')
  async searchAlegraItems(
    @Query('store') store: string,
    @Query('keywords') keywords?: string,
  ) {
    try {
      const client = this.alegraFactory.getClient(store);

      // With a keyword, one page of matches is enough.
      if (keywords) {
        const res = await this.alegraFactory.requestWithRetry(() =>
          client.get('/items', { params: { keywords } }),
        );
        return res.data;
      }

      // Without a keyword, Alegra caps pages at 30 — paginate to return the full list for the sede.
      return await this.alegraImportService.fetchAllAlegraItems(store);
    } catch (err) {
      rethrow(err, this.logger, 'searchAlegraItems');
    }
  }

  // ---------------------------------------------------------------------------
  // Alegra product import — cache + drafts (per sede)
  // ---------------------------------------------------------------------------

  @Post('alegra/sync-cache')
  @HttpCode(HttpStatus.OK)
  async syncAlegraProductCache(@Body() body: { storeKey?: string; storeKeys?: string[] }) {
    try {
      const storeKeys = Array.isArray(body?.storeKeys)
        ? body.storeKeys.filter((k) => typeof k === 'string' && k.trim())
        : body?.storeKey?.trim()
          ? [body.storeKey.trim()]
          : [];
      if (!storeKeys.length) {
        throw new HttpException('storeKey or storeKeys is required', HttpStatus.BAD_REQUEST);
      }
      if (storeKeys.length === 1) {
        return await this.alegraImportService.syncAlegraProductCache(storeKeys[0]);
      }
      return await this.alegraImportService.syncAlegraProductCacheForStores(storeKeys);
    } catch (err) {
      rethrow(err, this.logger, 'syncAlegraProductCache');
    }
  }

  @Post('alegra/generate-drafts')
  @HttpCode(HttpStatus.OK)
  async generateImportDrafts(@Body() body: { storeKey: string }) {
    try {
      if (!body?.storeKey?.trim()) {
        throw new HttpException('storeKey is required', HttpStatus.BAD_REQUEST);
      }
      return await this.alegraImportService.generateDrafts(body.storeKey.trim());
    } catch (err) {
      rethrow(err, this.logger, 'generateImportDrafts');
    }
  }

  @Get('import-drafts')
  async getImportDrafts(
    @Query('storeKey') storeKey?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      return await this.alegraImportService.findDrafts({
        storeKey: storeKey?.trim() || undefined,
        status: status?.trim() || undefined,
        search: search?.trim() || undefined,
        page: page ? Number(page) : 0,
        limit: limit ? Math.min(Number(limit), 100) : 50,
      });
    } catch (err) {
      rethrow(err, this.logger, 'getImportDrafts');
    }
  }

  @Get('import-drafts/counts')
  async getImportDraftsCounts(@Query('storeKey') storeKey?: string) {
    try {
      if (!storeKey?.trim()) {
        throw new HttpException('storeKey is required', HttpStatus.BAD_REQUEST);
      }
      return await this.alegraImportService.countDraftsByStatus(storeKey.trim());
    } catch (err) {
      rethrow(err, this.logger, 'getImportDraftsCounts');
    }
  }

  @Get('import-drafts/:id')
  async getImportDraftById(@Param('id') id: string) {
    try {
      return await this.alegraImportService.findDraftById(id);
    } catch (err) {
      rethrow(err, this.logger, 'getImportDraftById');
    }
  }

  @Patch('import-drafts/:id')
  async updateImportDraft(
    @Param('id') id: string,
    @Body()
    body: {
      categoryId?: string;
      variants?: { color: string; sku: string }[];
      salePrice?: number;
      hasIdentifier?: boolean;
      negativeSell?: boolean;
    },
  ) {
    try {
      return await this.alegraImportService.updateDraft(id, body);
    } catch (err) {
      rethrow(err, this.logger, 'updateImportDraft');
    }
  }

  @Post('import-drafts/:id/import')
  @HttpCode(HttpStatus.CREATED)
  async importDraft(@Param('id') id: string) {
    try {
      return await this.alegraImportService.importDraft(id);
    } catch (err) {
      rethrow(err, this.logger, 'importDraft');
    }
  }
}
