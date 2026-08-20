// Enum literals mirroring the backend enums.ts
export type TipoControl = 'IMEI' | 'SERIAL' | 'STOCK';

export type EstadoUnidad =
  | 'DISPONIBLE'
  | 'VENDIDO'
  | 'RESERVADO'
  | 'GARANTIA'
  | 'SERVICIO_TECNICO'
  | 'DEVUELTO'
  | 'DANADO'
  | 'BLOQUEADO';

export type AlegraSync = 'PENDIENTE' | 'SINCRONIZADO' | 'ERROR';

export type TipoMovimiento =
  | 'INGRESO'
  | 'VENTA'
  | 'DEVOLUCION'
  | 'GARANTIA'
  | 'AJUSTE'
  | 'TRASLADO'
  | 'RESERVA'
  | 'CANCELACION_RESERVA';

export type ImportDraftStatus = 'pending' | 'configured' | 'imported';

// ── Catalog entities ──────────────────────────────────────────────────────────

/** Category is now purely organizational — no longer configures imei/serial behavior. */
export interface Categoria {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
  /** @deprecated backend field name — kept for legacy component compat */
  nombre?: string;
  /** @deprecated backend field name — kept for legacy component compat */
  activo?: boolean;
}

// ── Location entities ─────────────────────────────────────────────────────────

export interface Bodega {
  id: string;
  nombre: string;
  activo: boolean;
  es_principal: boolean;
  /** Prefijo que antepone al nombre del producto al crear el ítem en Alegra (ej. "(P)" para Pereira). Vacío/null para la bodega principal. */
  prefix: string | null;
  alegra_warehouse_id: number | null;
  alegra_store_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface Sede {
  id: string;
  nombre: string;
  store_key: string;
  activo: boolean;
  bodegas?: Bodega[];
  created_at: string;
  updated_at: string;
}

// ── Inventory entities ────────────────────────────────────────────────────────

/**
 * Shared color catalog entry — backend `colors` table.
 * `hex_code` only shows up when this arrives nested off a ProductVariant/order item (the raw
 * entity column) instead of through the dedicated /colors endpoint (which maps it to `hexCode`).
 * Keep both optional here so templates can fall back to whichever one is actually present.
 */
export interface Color {
  id: string;
  name: string;
  hexCode: string | null;
  hex_code?: string | null;
}

/**
 * Color/SKU variant of a product. Always required, even for "flat" products like cables —
 * every product has at least one `ProductVariant`. Mirrors backend `product_variants` table.
 */
export interface ProductVariant {
  id: string;
  productId: string;
  color: Color | null;
  sku: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Product. Belongs to exactly ONE store (`storeId`) — no more publishing to multiple sedes.
 * SKU lives on `ProductVariant`; `salePrice` lives here — it's the same across all
 * color/SKU variants of a product.
 */
export interface Producto {
  id: string;
  name: string;
  active: boolean;
  /** Whether units of this product require an individual identifier (imei/serial). */
  hasIdentifier: boolean;
  /** Informational only — Alegra already supports selling without stock. */
  negativeSell: boolean;
  salePrice?: number | null;
  storeId: string;
  /** Flattened from the backend's nested `store.name` for convenience in templates/tables. */
  storeName?: string;
  store?: { id: string; name: string } | null;
  /** Present only right after an update() whose price/name push to Alegra failed for some warehouse. */
  alegraSyncWarning?: string;
  categoryId?: string;
  category?: Categoria;
  variants?: ProductVariant[];
  created_at: string;
  updated_at: string;
}

// ── Product detail (full ficha with stock per warehouse + units) ──────────────

export interface UnidadDetalle {
  id: string;
  identifier: string | null;
  active: boolean;
  entryDate: string | null;
  exitDate: string | null;
}

export interface StockPorBodega {
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  units?: UnidadDetalle[];
}

export interface VarianteDetalle {
  id: string;
  sku: string;
  active: boolean;
  color: Color | null;
  stockByWarehouse: StockPorBodega[];
  totalStock: number;
}

export interface ProductoDetalle {
  id: string;
  name: string;
  active: boolean;
  hasIdentifier: boolean;
  negativeSell: boolean;
  salePrice: number | null;
  category: { id: string; name: string };
  store: { id: string; name: string; storeKey: string };
  variants: VarianteDetalle[];
}

/**
 * Physical unit. Only exists when `Producto.hasIdentifier` is true. Collapses what used to be
 * `serial`/`imei1`/`imei2` into a single `identifier` field.
 */
export interface UnidadInventario {
  id: string;
  identifier: string | null;
  barcode?: string | null;
  salePrice?: number | null;
  active: boolean;
  productVariantId?: string;
  productVariant?: ProductVariant;
  bodega?: Bodega | null;
  entry_date?: string | null;
  exit_date?: string | null;
  created_at: string;
  updated_at: string;
}

// ── Alegra import (cache + drafts, per sede) ─────────────────────────────────

/** Raw cache of an Alegra item ("product"), one row per (store, alegra item). */
export interface AlegraProductCache {
  id: string;
  store_key: string;
  alegra_item_id: number;
  name: string;
  reference: string | null;
  price: number | null;
  status: string | null;
  raw?: Record<string, any> | null;
  alegra_warehouse_id: number | null;
  warehouse_id: string | null;
  /** Alegra's reported stock for this item, only when it was a genuine positive count (never -1/0). */
  available_quantity: number | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

/** Editable draft for turning an `AlegraProductCache` row into a local `Product` + first variant. */
export interface ProductImportDraft {
  id: string;
  alegra_product_cache_id: string;
  alegra_product_cache?: AlegraProductCache;
  store_key: string;
  suggested_name: string;
  suggested_sku: string | null;
  category_id: string | null;
  category?: Categoria | null;
  variants: { color: string; sku: string }[] | null;
  sale_price: number | null;
  has_identifier: boolean | null;
  negative_sell: boolean | null;
  status: ImportDraftStatus;
  product_id: string | null;
  product?: Producto | null;
  created_at: string;
  updated_at: string;
}

// ── Sync configuration ────────────────────────────────────────────────────────

// ── Paginated response ────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
}

// ── Dashboard stats ───────────────────────────────────────────────────────────

export interface StockByStore {
  storeId: string;
  name: string;
  outOfStock: number;
  inStock: number;
}

export interface InventoryStats {
  summary: {
    totalProducts: number;
    totalVariants: number;
    available: number;
    sold: number;
  };
  stockByStore: StockByStore[];
}

// Legacy aliases — kept for backward compatibility with existing components
/** @deprecated use StockByStore */
export type StockBySede = StockByStore;
