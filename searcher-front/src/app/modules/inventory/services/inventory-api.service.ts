import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';
import {
  Bodega,
  Categoria,
  Color,
  ImportDraftStatus,
  InventoryStats,
  PaginatedResponse,
  Producto,
  ProductImportDraft,
  ProductoDetalle,
  ProductVariant,
  Sede,
  UnidadInventario,
} from '../models/inventory.models';

export interface ProductForWarehouse {
  productId: string;
  productName: string;
  hasIdentifier: boolean;
  salePrice: number | null;
  variants: Array<{ id: string; color: Color | null; sku: string }>;
  alegra: { created: boolean; alegraItemId: number | null; alegraName: string | null };
}

/** A variant either references an existing color by id, or names a new one to find-or-create. */
export interface VariantColorInput {
  color?: string;
  colorId?: string;
  sku: string;
}

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

export interface CreateProductoDto {
  name: string;
  categoryId: string;
  storeId: string;
  hasIdentifier?: boolean;
  negativeSell?: boolean;
  salePrice?: number | null;
  variants: VariantColorInput[];
}

export interface UpdateProductoDto {
  name?: string;
  categoryId?: string;
  active?: boolean;
  hasIdentifier?: boolean;
  negativeSell?: boolean;
  salePrice?: number | null;
}

@Injectable({ providedIn: 'root' })
export class InventoryApiService {
  private api = environment.API_URL + '/inventory';

  constructor(private http: HttpClient) {}

  /** Backend returns store nested (store.name); flatten it into storeName for templates/tables. */
  private toProducto = (p: any): Producto => ({
    ...p,
    hasIdentifier: p.hasIdentifier ?? p.has_identifier ?? true,
    negativeSell: p.negativeSell ?? p.negative_sell ?? false,
    storeId: p.storeId ?? p.store?.id,
    storeName: p.storeName ?? p.store?.name,
  });

  getSedes(): Observable<Sede[]> {
    return this.http.get<Sede[]>(`${this.api}/stores`);
  }

  getProductos(params?: { storeId?: string; search?: string; page?: number; limit?: number }): Observable<PaginatedResponse<Producto>> {
    let p = new HttpParams();
    if (params?.storeId) p = p.set('storeId', params.storeId);
    if (params?.search) p = p.set('search', params.search);
    if (params?.page != null) p = p.set('page', String(params.page));
    if (params?.limit != null) p = p.set('limit', String(params.limit));
    return this.http.get<PaginatedResponse<any>>(`${this.api}/products`, { params: p }).pipe(
      map((res) => ({ data: res.data.map(this.toProducto), total: res.total })),
    );
  }

  createProducto(body: CreateProductoDto): Observable<Producto> {
    return this.http.post<any>(`${this.api}/products`, body).pipe(map(this.toProducto));
  }

  updateProducto(id: string, body: UpdateProductoDto): Observable<Producto> {
    return this.http.patch<any>(`${this.api}/products/${id}`, body).pipe(map(this.toProducto));
  }

  getProductoDetalle(id: string): Observable<Producto> {
    return this.http.get<any>(`${this.api}/products/${id}`).pipe(map(this.toProducto));
  }

  /** Ficha completa del producto: variantes con stock por bodega (+ unidades si es serializado). */
  getProductDetail(id: string): Observable<ProductoDetalle> {
    return this.http.get<ProductoDetalle>(`${this.api}/products/${id}/detail`);
  }

  deleteProducto(id: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.api}/products/${id}`);
  }

  deleteProductVariant(id: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.api}/product-variants/${id}`);
  }

  ingresoUnidades(productoId: string, body: unknown, preview = false): Observable<unknown> {
    return this.http.post<unknown>(
      `${this.api}/products/${productoId}/unit-entry?preview=${preview}`,
      body
    );
  }

  /** Unidades (Variant) ya creadas para un producto, sumando todas sus variantes de color —
   *  usado para el tope de importe parcial multi-sesión desde Pendientes. */
  getUnitCount(productoId: string): Observable<{ created: number }> {
    return this.http.get<{ created: number }>(`${this.api}/products/${productoId}/unit-count`);
  }

  buscarPorImei(imei: string): Observable<UnidadInventario> {
    return this.http.get<UnidadInventario>(`${this.api}/units/search`, { params: { identifier: imei } });
  }

  // ── Product variants (color + sku) ────────────────────────────────────────

  getVariantsByProduct(productId: string): Observable<ProductVariant[]> {
    return this.http.get<ProductVariant[]>(`${this.api}/products/${productId}/variants`);
  }

  createProductVariant(productId: string, body: VariantColorInput): Observable<ProductVariant> {
    return this.http.post<ProductVariant>(`${this.api}/products/${productId}/variants`, body);
  }

  updateProductVariant(id: string, body: { color?: string; colorId?: string; sku?: string; active?: boolean }): Observable<ProductVariant> {
    return this.http.patch<ProductVariant>(`${this.api}/product-variants/${id}`, body);
  }

  // ── Colors ─────────────────────────────────────────────────────────────────

  /** Without `query`, returns the full palette (admin screen). With it, up to 20 name matches (autocomplete). */
  searchColors(query?: string): Observable<Color[]> {
    let p = new HttpParams();
    if (query?.trim()) p = p.set('search', query.trim());
    return this.http.get<Color[]>(`${this.api}/colors`, { params: p });
  }

  updateColor(id: string, body: { name?: string; hexCode?: string }): Observable<Color> {
    return this.http.patch<Color>(`${this.api}/colors/${id}`, body);
  }

  createColor(body: { name: string; hexCode?: string }): Observable<Color> {
    return this.http.post<Color>(`${this.api}/colors`, body);
  }

  getCategorias(): Observable<Categoria[]> {
    return this.http.get<Categoria[]>(`${this.api}/categories`);
  }

  createCategoria(body: { nombre: string; descripcion?: string }): Observable<Categoria> {
    return this.http.post<Categoria>(`${this.api}/categories`, {
      name: body.nombre,
      description: body.descripcion,
    });
  }

  updateCategoria(id: string, body: { nombre?: string; descripcion?: string; activo?: boolean }): Observable<Categoria> {
    return this.http.patch<Categoria>(`${this.api}/categories/${id}`, {
      name: body.nombre,
      description: body.descripcion,
      active: body.activo,
    });
  }

  deleteCategoria(id: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.api}/categories/${id}`);
  }

  getUnitsByStore(f: { storeId: string; categoryId?: string; search?: string; imei?: string }): Observable<any[]> {
    let p = new HttpParams().set('storeId', f.storeId);
    if (f.categoryId) p = p.set('categoryId', f.categoryId);
    if (f.search) p = p.set('search', f.search);
    if (f.imei) p = p.set('identifier', f.imei);
    return this.http.get<any[]>(`${this.api}/units/by-store`, { params: p });
  }

  getContactsForManage(f: { storeId?: string; type?: 'client' | 'provider'; search?: string; page?: number; limit?: number }): Observable<{ data: any[]; total: number }> {
    let p = new HttpParams();
    if (f.storeId) p = p.set('storeId', f.storeId);
    if (f.type) p = p.set('type', f.type);
    if (f.search) p = p.set('search', f.search);
    if (f.page != null) p = p.set('page', String(f.page));
    if (f.limit != null) p = p.set('limit', String(f.limit));
    return this.http.get<{ data: any[]; total: number }>(`${this.api}/contacts/manage`, { params: p });
  }

  updateContact(id: string, body: {
    name?: string; identification?: string; email?: string; phone?: string; mobile?: string;
    address?: { address?: string | null; city?: string | null; department?: string | null; country?: string | null; zipCode?: string | null };
  }): Observable<any> {
    return this.http.patch<any>(`${this.api}/contacts/${id}`, body);
  }

  syncAllContacts(full = false): Observable<{ total: number; perStore: Array<{ store: string; synced: number; error?: string }> }> {
    const params = full ? new HttpParams().set('full', 'true') : undefined;
    return this.http.post<{ total: number; perStore: Array<{ store: string; synced: number; error?: string }> }>(
      `${this.api}/contacts/sync-all`, {}, { params },
    );
  }

  syncContactsForStore(storeKey: string, full = false): Observable<{ synced: number }> {
    const params = full ? new HttpParams().set('full', 'true') : undefined;
    return this.http.post<{ synced: number }>(`${this.api}/stores/${storeKey}/sync-contacts`, {}, { params });
  }

  getFungibleStockByStore(f: { storeId: string; categoryId?: string; search?: string }): Observable<Array<{ product: any; variant: any; quantity: number }>> {
    let p = new HttpParams().set('storeId', f.storeId);
    if (f.categoryId) p = p.set('categoryId', f.categoryId);
    if (f.search) p = p.set('search', f.search);
    return this.http.get<Array<{ product: any; variant: any; quantity: number }>>(`${this.api}/stock/fungible-by-store`, { params: p });
  }

  setVariantPrice(id: string, salePrice: number | null): Observable<any> {
    return this.http.patch<any>(`${this.api}/variants/${id}`, { salePrice });
  }

  setProductPrice(id: string, salePrice: number | null): Observable<any> {
    return this.http.patch<any>(`${this.api}/products/${id}`, { salePrice });
  }

  /** Response shape changed: no longer depends on requiresImei/sharedSerial (category-level config is gone). */
  resolveItemsConfig(store: string, alegraItemIds: number[]): Observable<Record<string, { mapped: boolean; hasIdentifier: boolean; productName?: string }>> {
    return this.http.post<Record<string, { mapped: boolean; hasIdentifier: boolean; productName?: string }>>(
      `${this.api}/items/resolve-config`,
      { store, alegraItemIds },
    );
  }

  /** Backend returns English field names (name/is_main/active); map to the Spanish shape the UI uses. */
  private toBodega = (w: any): Bodega => ({
    ...w,
    nombre: w.name ?? w.nombre,
    es_principal: w.is_main ?? w.es_principal ?? false,
    activo: w.active ?? w.activo ?? true,
  });

  getBodegasByStoreKey(storeKey: string): Observable<Bodega[]> {
    return this.http
      .get<any[]>(`${this.api}/stores/${storeKey}/warehouses`)
      .pipe(map((list) => list.map(this.toBodega)));
  }

  syncWarehousesFromAlegra(storeKey: string): Observable<Bodega[]> {
    return this.http
      .post<any[]>(`${this.api}/stores/${storeKey}/sync-warehouses`, {})
      .pipe(map((list) => list.map(this.toBodega)));
  }

  createBodega(body: { sedeId: string; nombre: string; esPrincipal?: boolean; prefix?: string; alegraWarehouseId?: number; alegraStoreKey?: string }): Observable<Bodega> {
    return this.http
      .post<any>(`${this.api}/warehouses`, {
        storeId: body.sedeId,
        name: body.nombre,
        isMain: body.esPrincipal,
        prefix: body.prefix,
        alegraWarehouseId: body.alegraWarehouseId,
        alegraStoreKey: body.alegraStoreKey,
      })
      .pipe(map(this.toBodega));
  }

  updateBodega(id: string, body: { nombre?: string; esPrincipal?: boolean; activo?: boolean; prefix?: string | null; alegraWarehouseId?: number; alegraStoreKey?: string }): Observable<Bodega> {
    return this.http
      .patch<any>(`${this.api}/warehouses/${id}`, {
        name: body.nombre,
        isMain: body.esPrincipal,
        active: body.activo,
        prefix: body.prefix,
        alegraWarehouseId: body.alegraWarehouseId,
        alegraStoreKey: body.alegraStoreKey,
      })
      .pipe(map(this.toBodega));
  }

  getStats(): Observable<InventoryStats> {
    return this.http.get<InventoryStats>(`${this.api}/stats`);
  }

  // ── Products by warehouse (purchase-order product picker) ────────────────

  /**
   * Resolves variants by id directly, regardless of the warehouse's product-page or active-status
   * filters — used to redisplay a purchase order draft's saved variant even if it fell outside
   * `getProductsForWarehouse`'s page or was later deactivated.
   */
  getVariantsByIds(
    ids: string[],
  ): Observable<Array<{ id: string; sku: string; color: Color | null; productId: string; productName: string }>> {
    if (!ids.length) return of([]);
    const params = new HttpParams().set('ids', ids.join(','));
    return this.http.get<Array<{ id: string; sku: string; color: Color | null; productId: string; productName: string }>>(
      `${this.api}/product-variants/by-ids`,
      { params },
    );
  }

  getProductsForWarehouse(
    warehouseId: string,
    params?: { search?: string; page?: number; limit?: number },
  ): Observable<PaginatedResponse<ProductForWarehouse>> {
    let p = new HttpParams();
    if (params?.search) p = p.set('search', params.search);
    if (params?.page != null) p = p.set('page', String(params.page));
    if (params?.limit != null) p = p.set('limit', String(params.limit));
    return this.http.get<PaginatedResponse<ProductForWarehouse>>(
      `${this.api}/warehouses/${warehouseId}/products`,
      { params: p },
    );
  }

  // ── Product publishing to Alegra (per warehouse) ──────────────────────────

  publishProduct(productId: string, warehouseIds: string[]): Observable<PublishResult[]> {
    return this.http.post<PublishResult[]>(`${this.api}/products/${productId}/publish`, { warehouseIds });
  }

  createInWarehouse(productId: string, warehouseId: string): Observable<PublishResult> {
    return this.http.post<PublishResult>(`${this.api}/products/${productId}/create-in-warehouse`, { warehouseId });
  }

  getAlegraStatus(productId: string): Observable<AlegraStatusRow[]> {
    return this.http.get<AlegraStatusRow[]>(`${this.api}/products/${productId}/alegra-status`);
  }

  // ── Alegra product import — cache + drafts (per sede) ─────────────────────

  syncAlegraCache(storeKey: string): Observable<unknown> {
    return this.http.post(`${this.api}/alegra/sync-cache`, { storeKey });
  }

  generateImportDrafts(storeKey: string): Observable<unknown> {
    return this.http.post(`${this.api}/alegra/generate-drafts`, { storeKey });
  }

  getImportDrafts(f?: { storeKey?: string; status?: ImportDraftStatus; search?: string; hasStock?: boolean; page?: number; limit?: number }): Observable<PaginatedResponse<ProductImportDraft>> {
    let p = new HttpParams();
    if (f?.storeKey) p = p.set('storeKey', f.storeKey);
    if (f?.status) p = p.set('status', f.status);
    if (f?.search) p = p.set('search', f.search);
    if (f?.hasStock) p = p.set('hasStock', 'true');
    if (f?.page != null) p = p.set('page', String(f.page));
    if (f?.limit != null) p = p.set('limit', String(f.limit));
    return this.http.get<PaginatedResponse<ProductImportDraft>>(`${this.api}/import-drafts`, { params: p });
  }

  getImportDraftsCounts(storeKey: string): Observable<{ pending: number; configured: number; imported: number; total: number }> {
    return this.http.get<{ pending: number; configured: number; imported: number; total: number }>(
      `${this.api}/import-drafts/counts`, { params: { storeKey } },
    );
  }

  getImportDraftById(id: string): Observable<ProductImportDraft> {
    return this.http.get<ProductImportDraft>(`${this.api}/import-drafts/${id}`);
  }

  updateImportDraft(id: string, body: { categoryId?: string; variants?: { color: string; sku: string }[]; salePrice?: number; hasIdentifier?: boolean; negativeSell?: boolean }): Observable<ProductImportDraft> {
    return this.http.patch<ProductImportDraft>(`${this.api}/import-drafts/${id}`, body);
  }

  importDraft(id: string): Observable<Producto> {
    return this.http.post<any>(`${this.api}/import-drafts/${id}/import`, {}).pipe(map(this.toProducto));
  }
}
