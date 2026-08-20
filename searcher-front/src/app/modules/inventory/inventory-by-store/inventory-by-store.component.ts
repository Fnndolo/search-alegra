import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TableModule } from 'primeng/table';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { InventoryApiService } from '../services/inventory-api.service';

@Component({
  selector: 'app-inventory-by-store',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TableModule, DropdownModule, InputTextModule,
    InputNumberModule, ButtonModule, IconFieldModule, InputIconModule, TagModule, ToastModule,
  ],
  providers: [MessageService],
  templateUrl: './inventory-by-store.component.html',
})
export class InventoryByStoreComponent implements OnInit {
  sedes: any[] = [];
  categorias: any[] = [];
  categoriaOptions: any[] = [];

  selectedStoreId: string | null = null;
  selectedCategoriaId: string | null = null;
  searchValue = '';

  units: any[] = [];
  /** `units` grouped by product — one row per product, total count summed across every bodega and
   *  color. Expanding a row breaks it down Bodega → Color → IMEIs (same order as "¿cuánto tengo en
   *  tal bodega?", the day-to-day question) — a store with 50 of the same phone must show ONE row
   *  (50), not 50 rows, and the bodega/color/IMEI detail stays one click away instead of always on screen. */
  groupedProducts: Array<{
    productId: string;
    productName: string;
    categoryName: string | null;
    /** Promedio de `cost_price` solo entre las unidades activas (en stock) de este producto en
     *  esta sede — lo ya vendido no debe pesar en el costo de lo que queda. Null si ninguna
     *  unidad tiene costo registrado (ingresos anteriores a que este campo existiera). */
    costoPromedio: number | null;
    totalCount: number;
    warehouses: Array<{
      warehouseId: string;
      warehouseName: string;
      count: number;
      variants: Array<{
        variantId: string;
        color: any;
        sku: string;
        count: number;
        units: any[];
      }>;
    }>;
  }> = [];
  expandedProducts = new Set<string>();
  fungibles: any[] = [];
  loading = false;
  savingPrice: Record<string, boolean> = {};

  private searchSubject = new Subject<void>();

  constructor(
    private api: InventoryApiService,
    private messageService: MessageService,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    // Deep-link from the products tab: ?storeId=...&search=...
    const qp = this.route.snapshot.queryParamMap;
    const storeId = qp.get('storeId');
    const search = qp.get('search');
    if (storeId) this.selectedStoreId = storeId;
    if (search) this.searchValue = search;

    // No deep-link store — fall back to the last one picked here. Without this, navigating away
    // and back (a full route change destroys/recreates this component) resets to sedes[0] every
    // time instead of remembering what the user was actually looking at.
    if (!storeId) {
      const savedStoreId = sessionStorage.getItem('inventory_selectedStoreId');
      if (savedStoreId) this.selectedStoreId = savedStoreId;
    }

    this.loadSedes();
    this.loadCategorias();

    this.searchSubject.pipe(debounceTime(350), distinctUntilChanged())
      .subscribe(() => this.loadUnits());

    // When arriving via deep-link the store is already set — load now (loadSedes won't auto-select).
    if (this.selectedStoreId) this.loadUnits();
  }

  loadSedes() {
    this.api.getSedes().subscribe({
      next: (data: any[]) => {
        this.sedes = data.map((s) => ({ ...s, nombre: s.name }));
        if (this.sedes.length && !this.selectedStoreId) {
          this.selectedStoreId = this.sedes[0].id;
          this.loadUnits();
        }
      },
      error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar las sedes' }),
    });
  }

  loadCategorias() {
    this.api.getCategorias().subscribe({
      next: (data: any[]) => {
        this.categorias = data;
        this.categoriaOptions = [{ id: null, name: 'Todas las categorías' }, ...data];
      },
      error: () => {},
    });
  }

  loadUnits() {
    if (!this.selectedStoreId) {
      this.units = [];
      this.fungibles = [];
      return;
    }
    const filters = {
      storeId: this.selectedStoreId,
      categoryId: this.selectedCategoriaId || undefined,
      search: this.searchValue.trim() || undefined,
    };
    this.loading = true;

    // Con variantes (per-unit) + sin variantes (fungible, by quantity) live in two shapes.
    let pending = 2;
    // Explicit detectChanges after each async response: with zone.js `eventCoalescing` enabled
    // (see app.config.ts), a fast HTTP response that resolves before the next browser event can
    // leave the view stale until some unrelated event (e.g. a click) triggers a check — this
    // component isn't OnPush, but coalescing still defers the paint without this.
    const done = () => { if (--pending === 0) this.loading = false; this.cdr.detectChanges(); };

    this.api.getUnitsByStore(filters).subscribe({
      next: (data) => { this.units = data ?? []; this.buildGroupedProducts(); done(); },
      error: () => {
        this.units = [];
        this.groupedProducts = [];
        done();
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar las unidades' });
      },
    });

    this.api.getFungibleStockByStore(filters).subscribe({
      next: (data) => { this.fungibles = data ?? []; done(); },
      error: () => {
        this.fungibles = [];
        done();
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo cargar el stock de fungibles' });
      },
    });
  }

  private buildGroupedProducts(): void {
    type WarehouseGroup = (typeof this.groupedProducts)[number]['warehouses'][number];
    type VariantGroup = WarehouseGroup['variants'][number];

    const products = new Map<string, typeof this.groupedProducts[number]>();
    const warehousesByProduct = new Map<string, Map<string, WarehouseGroup>>();
    const variantsByProductWarehouse = new Map<string, Map<string, VariantGroup>>();
    // Running sum/count per product to average cost_price across only the units actually loaded
    // here (`this.units` already comes filtered to active/in-stock — see getUnitsByStore) —
    // units without a recorded cost (pre-existing before this field was added) don't count
    // towards the average instead of silently dragging it towards zero.
    const costAccum = new Map<string, { sum: number; count: number }>();

    for (const u of this.units) {
      const productId = u.product_variant?.product?.id;
      const variantId = u.product_variant?.id;
      const warehouseId = u.warehouse?.id ?? 'sin-bodega';
      const warehouseName = u.warehouse?.name ?? 'Sin bodega asignada';
      if (!productId || !variantId) continue;

      let product = products.get(productId);
      if (!product) {
        product = {
          productId,
          productName: u.product_variant.product.name,
          categoryName: u.product_variant.product.category?.name ?? null,
          costoPromedio: null,
          totalCount: 0,
          warehouses: [],
        };
        products.set(productId, product);
        warehousesByProduct.set(productId, new Map());
        costAccum.set(productId, { sum: 0, count: 0 });
      }

      if (u.cost_price != null) {
        const acc = costAccum.get(productId)!;
        acc.sum += Number(u.cost_price);
        acc.count++;
      }

      const warehouseMap = warehousesByProduct.get(productId)!;
      let warehouse = warehouseMap.get(warehouseId);
      if (!warehouse) {
        warehouse = { warehouseId, warehouseName, count: 0, variants: [] };
        warehouseMap.set(warehouseId, warehouse);
        product.warehouses.push(warehouse);
      }

      const variantKey = `${warehouseId}::${variantId}`;
      let variantMap = variantsByProductWarehouse.get(productId);
      if (!variantMap) {
        variantMap = new Map();
        variantsByProductWarehouse.set(productId, variantMap);
      }
      let variant = variantMap.get(variantKey);
      if (!variant) {
        variant = {
          variantId,
          color: u.product_variant.color,
          sku: u.product_variant.sku,
          count: 0,
          units: [],
        };
        variantMap.set(variantKey, variant);
        warehouse.variants.push(variant);
      }

      variant.count++;
      variant.units.push(u);
      warehouse.count++;
      product.totalCount++;
    }

    for (const product of products.values()) {
      const acc = costAccum.get(product.productId);
      product.costoPromedio = acc && acc.count > 0 ? acc.sum / acc.count : null;
    }

    this.groupedProducts = Array.from(products.values());
  }

  toggleProductExpand(productId: string): void {
    if (this.expandedProducts.has(productId)) this.expandedProducts.delete(productId);
    else this.expandedProducts.add(productId);
  }

  /** Fungible rows carry salePrice on the Product — it's the same across all its color variants. */
  saveProductPrice(row: any) {
    const id = row.product.id;
    this.savingPrice[id] = true;
    this.api.setProductPrice(id, row.product.sale_price ?? null).subscribe({
      next: () => {
        this.savingPrice[id] = false;
        this.messageService.add({ severity: 'success', summary: 'Precio actualizado' });
      },
      error: () => {
        this.savingPrice[id] = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo guardar el precio' });
      },
    });
  }

  onStoreChange() {
    if (this.selectedStoreId) {
      sessionStorage.setItem('inventory_selectedStoreId', this.selectedStoreId);
    } else {
      sessionStorage.removeItem('inventory_selectedStoreId');
    }
    this.loadUnits();
  }

  onCategoriaChange() {
    this.loadUnits();
  }

  onSearchChange() {
    this.searchSubject.next();
  }

  /** Clears category and search filters (keeps the store, required to query). */
  clearFilters() {
    this.selectedCategoriaId = null;
    this.searchValue = '';
    this.loadUnits();
  }

  get hasFilters(): boolean {
    return !!this.selectedCategoriaId || !!this.searchValue.trim();
  }
}
