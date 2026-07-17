import { Component, OnInit, signal, inject, DestroyRef, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { MessageService } from 'primeng/api';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';

import { ButtonModule } from 'primeng/button';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CalendarModule } from 'primeng/calendar';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { DividerModule } from 'primeng/divider';
import { TagModule } from 'primeng/tag';

import { PurchaseOrdersService } from '../purchase-orders.service';
import { InventoryApiService, ProductForWarehouse } from '../../services/inventory-api.service';

interface StoreOption {
  label: string;
  value: string;
  id: string;
}

interface ProviderOption {
  label: string;
  value: number;
  identification?: string;
}

interface WarehouseOption {
  label: string;
  value: string;         // alegra warehouse id (string)
  warehouseId?: string;  // internal UUID
}

interface ProductOption {
  label: string;
  value: string; // productId
  product: ProductForWarehouse;
  /**
   * Space-joined SKUs of this product's variants — PrimeNG's `p-dropdown` with `[filter]="true"`
   * ALWAYS re-filters `[options]` client-side against `optionLabel` (contains match), on top of
   * whatever the server already returned via `(onFilter)`. The server search matches SKU fine,
   * but the label only shows the product name, so PrimeNG's own filter then hides that correct
   * result. `[filterBy]="'label,skus'"` tells it to also match this field.
   */
  skus: string;
}

@Component({
  selector: 'app-create-order',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    DropdownModule,
    InputTextModule,
    InputNumberModule,
    CalendarModule,
    TextareaModule,
    ToastModule,
    DividerModule,
    TagModule,
  ],
  providers: [MessageService],
  templateUrl: './create-order.component.html',
})
export class CreateOrderComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  form!: FormGroup;
  submitting = signal(false);
  savingDraft = signal(false);
  submittingToAlegra = signal(false);
  loadingOrder = signal(false);
  syncingContacts = signal(false);
  loadingProducts = signal(false);

  editMode = false;
  editOrderId: number | null = null;
  submitAttempted = false;

  /** Monotonic counter for preventing stale provider/warehouse responses. */
  private requestSeq = 0;
  /** Per-item-group subscriptions for total-quantity → single-allocation sync (see `onItemQuantityChange`). */
  private readonly itemQuantitySubs = new Map<FormGroup, Subscription>();
  /** Per-allocation-group subscriptions for quantity → unit (IMEI) row sync. */
  private readonly allocationQuantitySubs = new Map<FormGroup, Subscription>();
  /** Source product behind each item row — drives the per-allocation variant dropdowns. */
  private readonly itemProducts = new Map<FormGroup, ProductForWarehouse>();

  stores: StoreOption[] = [];
  providers: ProviderOption[] = [];
  warehouses: WarehouseOption[] = [];
  productOptions: ProductOption[] = [];
  /** True once products were loaded for the selected warehouse and the list came back empty. */
  noProductsForWarehouse = false;

  get items(): FormArray {
    return this.form.get('items') as FormArray;
  }

  get total(): number {
    let t = 0;
    for (let i = 0; i < this.items.length; i++) {
      const v = this.items.at(i).value;
      t += (v.price ?? 0) * (v.quantity ?? 0);
    }
    return t;
  }

  constructor(
    private readonly fb: FormBuilder,
    private readonly service: PurchaseOrdersService,
    private readonly inventoryApi: InventoryApiService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly messageService: MessageService,
  ) {}

  ngOnInit(): void {
    this.buildForm();
    this.loadStores();

    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.editMode = true;
      this.editOrderId = Number(idParam);
      this.loadOrderForEdit(this.editOrderId);
    }
  }

  private buildForm(): void {
    const today = new Date().toISOString().split('T')[0];
    this.form = this.fb.group({
      store: ['', Validators.required],
      // Disabled until a store is selected (reactive-form-driven, not the [disabled] attribute).
      providerId: [{ value: null, disabled: true }],
      providerName: [''],
      providerIdentification: [''],
      date: [today, Validators.required],
      dueDate: [today, Validators.required],
      alegraWarehouseId: [{ value: '', disabled: true }],
      alegraWarehouseName: [''],
      warehouseId: [''],
      observations: [''],
      items: this.fb.array([]),
    });
  }

  private loadStores(): void {
    this.inventoryApi.getSedes().subscribe({
      next: (sedes: any[]) => {
        this.stores = sedes.map((s) => ({
          label: s.name ?? s.nombre,
          value: s.store_key,
          id: s.id,
        }));
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar las tiendas' });
      },
    });
  }

  onStoreChange(storeKey: string): void {
    this.providers = [];
    this.warehouses = [];
    this.productOptions = [];
    this.noProductsForWarehouse = false;
    this.clearItems();

    const providerCtrl = this.form.get('providerId');
    const warehouseCtrl = this.form.get('alegraWarehouseId');

    // Reset dependent selections from the previous store.
    this.form.patchValue({
      providerId: null, providerName: '', providerIdentification: '',
      alegraWarehouseId: '', alegraWarehouseName: '', warehouseId: '',
    });

    if (!storeKey) {
      providerCtrl?.disable();
      warehouseCtrl?.disable();
      return;
    }
    providerCtrl?.enable();
    warehouseCtrl?.enable();

    const seq = ++this.requestSeq;
    this.loadWarehouses(storeKey, seq);
    this.loadInitialProviders(storeKey, seq);
  }

  /** Force a re-sync of the contacts cache from Alegra, then reload providers. */
  syncContacts(): void {
    const store = this.form.value.store;
    if (!store) return;
    this.syncingContacts.set(true);
    this.service.syncContacts(store).subscribe({
      next: (r) => {
        this.syncingContacts.set(false);
        this.providers = [];
        this.loadInitialProviders(store, ++this.requestSeq);
        this.messageService.add({ severity: 'success', summary: 'Proveedores actualizados', detail: `${r.synced} contactos sincronizados` });
      },
      error: () => {
        this.syncingContacts.set(false);
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron sincronizar los contactos' });
      },
    });
  }

  /** Safety net: load providers when the dropdown opens, in case the store-change trigger was missed. */
  ensureProvidersLoaded(): void {
    const store = this.form.value.store;
    if (store && !this.providers.length) {
      this.loadInitialProviders(store, ++this.requestSeq);
    }
  }

  private loadInitialProviders(storeKey: string, seq: number): void {
    this.service.searchProviders(storeKey, '').subscribe({
      next: (results: any[]) => {
        if (seq !== this.requestSeq) return;
        const loaded: ProviderOption[] = results.map((r) => ({
          label: r.name,
          value: r.id,
          identification: r.identification,
        }));
        // Preserve any pre-set provider (e.g., from edit-mode order load)
        const existing = this.providers.filter((p) => !loaded.some((l) => l.value === p.value));
        this.providers = [...existing, ...loaded];
      },
      error: () => {
        if (seq !== this.requestSeq) return;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar los proveedores' });
      },
    });
  }

  private loadWarehouses(storeKey: string, seq: number): void {
    this.service.getWarehouses(storeKey).subscribe({
      next: (warehouses: any[]) => {
        if (seq !== this.requestSeq) return;
        const loaded: WarehouseOption[] = warehouses.map((w) => ({
          label: w.name ?? w.nombre,
          value: String(w.alegra_warehouse_id ?? w.id),
          warehouseId: w.id,
        }));
        const existing = this.warehouses.filter((w) => !loaded.some((l) => l.value === w.value));
        this.warehouses = [...existing, ...loaded];
      },
      error: () => {
        if (seq !== this.requestSeq) return;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar las bodegas' });
      },
    });
  }

  onWarehouseChange(alegraWarehouseId: string): void {
    const wh = this.warehouses.find((w) => w.value === alegraWarehouseId);
    this.form.patchValue({
      alegraWarehouseName: wh?.label ?? '',
      warehouseId: wh?.warehouseId ?? '',
    });
    this.productOptions = [];
    this.noProductsForWarehouse = false;
    if (wh?.warehouseId) {
      this.loadProductsForWarehouse(wh.warehouseId);
    }
  }

  searchProviders(event: any): void {
    const store = this.form.value.store;
    if (!store || !event.filter) return;
    this.service.searchProviders(store, event.filter).subscribe({
      next: (results: any[]) => {
        this.providers = results.map((r) => ({
          label: r.name,
          value: r.id,
          identification: r.identification,
        }));
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Error al buscar proveedores' });
      },
    });
  }

  onProviderSelect(providerId: number): void {
    const provider = this.providers.find((p) => p.value === providerId);
    if (provider) {
      this.form.patchValue({
        providerId: provider.value,
        providerName: provider.label,
        providerIdentification: provider.identification ?? '',
      });
    }
  }

  // ─── Local product picker (camino 1 / camino 2) ─────────────────────────────

  /** Loads the local products already linked to an Alegra item for the selected warehouse. */
  loadProductsForWarehouse(warehouseId: string, search?: string): void {
    this.loadingProducts.set(true);
    this.inventoryApi.getProductsForWarehouse(warehouseId, { search, limit: 100 }).subscribe({
      next: (res) => {
        this.loadingProducts.set(false);
        this.productOptions = res.data.map((p) => ({
          label: p.productName,
          value: p.productId,
          product: p,
          skus: p.variants.map((v) => v.sku).join(' '),
        }));
        this.noProductsForWarehouse = !search && this.productOptions.length === 0;
        this.linkExistingItemsToProducts(res.data);
      },
      error: () => {
        this.loadingProducts.set(false);
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar los productos de la bodega' });
      },
    });
  }

  /**
   * Rows rebuilt from a loaded order (`patchFormFromOrder`) only carry `productVariantId` in the
   * form — `itemProducts` (which drives `variantOptions()`, i.e. the color/SKU dropdown) is never
   * populated for them, so the selected variant renders as blank even though the value is intact.
   * Once the warehouse's products load, back-fill `itemProducts` for any row still missing it.
   *
   * `products` is the warehouse's product PAGE (up to 100, alphabetical) filtered to active
   * variants — the saved item's product may fall outside that page, or its variant may have been
   * deactivated since. For anything still unmatched, resolve it directly by variant id instead of
   * depending on that page's contents.
   */
  private linkExistingItemsToProducts(products: ProductForWarehouse[]): void {
    for (const group of this.items.controls as FormGroup[]) {
      if (this.itemProducts.has(group)) continue;
      const firstVariantId = (group.get('variants') as FormArray).at(0)?.get('productVariantId')?.value;
      if (!firstVariantId) continue;
      const match = products.find((p) => p.variants.some((v) => v.id === firstVariantId));
      if (match) this.itemProducts.set(group, match);
    }

    const unresolvedGroups = (this.items.controls as FormGroup[]).filter((group) => !this.itemProducts.has(group));
    if (!unresolvedGroups.length) return;

    const allVariantIds = unresolvedGroups.flatMap((group) =>
      (group.get('variants') as FormArray).controls
        .map((c) => c.get('productVariantId')?.value)
        .filter((id): id is string => !!id),
    );
    if (!allVariantIds.length) return;

    this.inventoryApi.getVariantsByIds(allVariantIds).subscribe({
      next: (variants) => {
        for (const group of unresolvedGroups) {
          const groupVariantIds = (group.get('variants') as FormArray).controls
            .map((c) => c.get('productVariantId')?.value)
            .filter((id): id is string => !!id);
          const resolvedForGroup = variants.filter((v) => groupVariantIds.includes(v.id));
          if (!resolvedForGroup.length) continue;
          const first = resolvedForGroup[0];
          this.itemProducts.set(group, {
            productId: first.productId,
            productName: first.productName,
            hasIdentifier: !!group.get('hasIdentifier')?.value,
            salePrice: null,
            // Only the variants already used by this order's allocations are known here (the
            // product fell outside the warehouse's product page) — "Agregar variante" won't have
            // extra colors to offer for these rows, which is an acceptable edge case.
            variants: resolvedForGroup.map((v) => ({ id: v.id, color: v.color, sku: v.sku })),
            alegra: { created: true, alegraItemId: group.get('alegraItemId')?.value ?? null, alegraName: null },
          });
        }
        // `InventoryLayoutComponent` (ancestor, wraps the router-outlet) is OnPush. This callback
        // only mutates a plain Map with no signal write alongside it, so nothing marks that
        // ancestor dirty — Angular would otherwise never re-check this view to show the result.
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  searchProducts(event: any): void {
    const warehouseId = this.form.value.warehouseId;
    if (!warehouseId) return;
    this.loadProductsForWarehouse(warehouseId, event.filter);
  }

  addProduct(option: ProductOption | null): void {
    if (!option) return;
    const product = option.product;

    // A product enters the order ONCE as a top-level row — multiple colors are handled as
    // "variant allocations" INSIDE that row (see addVariantAllocation), not as separate rows.
    const existingGroup = this.items.controls.find(
      (c) => this.itemProducts.get(c as FormGroup)?.productId === product.productId,
    ) as FormGroup | undefined;
    if (existingGroup) {
      this.messageService.add({
        severity: 'info',
        summary: 'Ya agregado',
        detail: `${product.productName} ya está en la orden — usá "Agregar variante" en esa fila para sumarle otro color.`,
        life: 7000,
      });
      return;
    }

    const defaultVariant = product.variants[0] ?? null;
    const firstAllocation = this.buildVariantAllocationGroup(defaultVariant?.id ?? null, 1, product.hasIdentifier);

    const itemGroup = this.fb.group({
      alegraItemId: [product.alegra.alegraItemId, Validators.required],
      name: [product.alegra.alegraName ?? product.productName],
      price: [product.salePrice ?? 0, [Validators.required, Validators.min(1)]],
      quantity: [1, [Validators.required, Validators.min(1)]],
      hasIdentifier: [product.hasIdentifier],
      variants: this.fb.array([firstAllocation]),
    });

    this.itemProducts.set(itemGroup, product);

    const sub = itemGroup.get('quantity')!.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((qty) => this.onItemQuantityChange(itemGroup, qty ?? 1));
    this.itemQuantitySubs.set(itemGroup, sub);

    this.items.push(itemGroup);
  }

  /** Only auto-resizes the single allocation while there's just one color — with 2+ colors it's ambiguous which one the extra/removed units belong to, so the operator rebalances manually. */
  private onItemQuantityChange(itemGroup: FormGroup, qty: number): void {
    const allocations = itemGroup.get('variants') as FormArray;
    if (allocations.length === 1) {
      (allocations.at(0) as FormGroup).get('quantity')?.setValue(qty);
    }
  }

  productLabel(index: number): string {
    const group = this.items.at(index) as FormGroup;
    return this.itemProducts.get(group)?.productName ?? group.get('name')?.value ?? '';
  }

  variantAllocations(itemIndex: number): FormArray {
    return this.items.at(itemIndex).get('variants') as FormArray;
  }

  /** Sum of all variant allocations' quantities for this product — compare against the total to know if it's fully split. */
  allocatedQuantity(itemIndex: number): number {
    return this.variantAllocations(itemIndex).controls
      .reduce((sum, c) => sum + (c.get('quantity')?.value ?? 0), 0);
  }

  remainingQuantity(itemIndex: number): number {
    const total = this.items.at(itemIndex).get('quantity')?.value ?? 0;
    return total - this.allocatedQuantity(itemIndex);
  }

  /** Upper bound for one allocation's quantity input: can't push the sum past the product's total. */
  maxForAllocation(itemIndex: number, allocIndex: number): number {
    const total = this.items.at(itemIndex).get('quantity')?.value ?? 0;
    const others = this.variantAllocations(itemIndex).controls
      .filter((_, idx) => idx !== allocIndex)
      .reduce((sum, c) => sum + (c.get('quantity')?.value ?? 0), 0);
    return Math.max(1, total - others);
  }

  /** Variant options for one allocation's color dropdown — excludes colors already used by this product's OTHER allocations. */
  variantOptionsFor(itemIndex: number, allocIndex: number): Array<{ label: string; value: string; hexCode: string | null }> {
    const itemGroup = this.items.at(itemIndex) as FormGroup;
    const product = this.itemProducts.get(itemGroup);
    if (!product) return [];
    const allocations = this.variantAllocations(itemIndex);
    const currentValue = (allocations.at(allocIndex) as FormGroup).get('productVariantId')?.value;
    const usedByOthers = new Set(
      allocations.controls
        .filter((_, idx) => idx !== allocIndex)
        .map((c) => c.get('productVariantId')?.value),
    );
    return product.variants
      .filter((v) => v.id === currentValue || !usedByOthers.has(v.id))
      .map((v) => ({
        label: `${v.color?.name ?? 'Sin color'} — ${v.sku}`,
        value: v.id,
        hexCode: v.color?.hexCode ?? null,
      }));
  }

  /**
   * Adds a new color allocation. If there's unassigned capacity (total > sum of allocations) it
   * takes all of it; otherwise every unit is already claimed, so it steals 1 unit from whichever
   * allocation currently has the most — the operator then rebalances both with the quantity
   * spinners (e.g. move units from Silver to Orange), matching how they'd naturally split a
   * fixed total across colors instead of needing to shrink one manually before adding the other.
   */
  addVariantAllocation(itemIndex: number): void {
    const itemGroup = this.items.at(itemIndex) as FormGroup;
    const product = this.itemProducts.get(itemGroup);
    if (!product) return;

    const allocations = this.variantAllocations(itemIndex);
    const usedIds = new Set(allocations.controls.map((c) => c.get('productVariantId')?.value));
    const availableVariant = product.variants.find((v) => !usedIds.has(v.id));
    if (!availableVariant) {
      this.messageService.add({
        severity: 'info',
        summary: 'Sin más colores',
        detail: `${product.productName} no tiene más variantes de color disponibles en esta bodega.`,
      });
      return;
    }

    const total = itemGroup.get('quantity')?.value ?? 0;
    if (allocations.length >= total) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Subí la cantidad total',
        detail: `Con ${total} unidad(es) no hay para repartir en ${allocations.length + 1} colores — subí la cantidad total del producto primero.`,
        life: 7000,
      });
      return;
    }

    const remaining = this.remainingQuantity(itemIndex);
    let newQty: number;
    if (remaining > 0) {
      newQty = remaining;
    } else {
      const donor = (allocations.controls as FormGroup[]).reduce((biggest, c) =>
        (c.get('quantity')?.value ?? 0) > (biggest.get('quantity')?.value ?? 0) ? c : biggest,
      );
      donor.get('quantity')?.setValue((donor.get('quantity')?.value ?? 1) - 1);
      newQty = 1;
    }

    const hasIdentifier = !!itemGroup.get('hasIdentifier')?.value;
    allocations.push(this.buildVariantAllocationGroup(availableVariant.id, newQty, hasIdentifier));
  }

  /** A product needs at least one allocation — to remove it entirely, use the row's trash icon instead. */
  removeVariantAllocation(itemIndex: number, allocIndex: number): void {
    const allocations = this.variantAllocations(itemIndex);
    if (allocations.length <= 1) {
      this.messageService.add({
        severity: 'info',
        summary: 'No se puede quitar',
        detail: 'Un producto necesita al menos una variante — para sacarlo del todo, usá el ícono de basura de la fila.',
      });
      return;
    }
    const allocGroup = allocations.at(allocIndex) as FormGroup;
    this.allocationQuantitySubs.get(allocGroup)?.unsubscribe();
    this.allocationQuantitySubs.delete(allocGroup);
    allocations.removeAt(allocIndex);
  }

  private buildUnitGroup(): FormGroup {
    return this.fb.group({ identifier: [''] });
  }

  private buildVariantAllocationGroup(variantId: string | null, quantity: number, hasIdentifier: boolean): FormGroup {
    const allocGroup = this.fb.group({
      productVariantId: [variantId, Validators.required],
      quantity: [quantity, [Validators.required, Validators.min(1)]],
      units: this.fb.array(
        hasIdentifier ? Array.from({ length: quantity }, () => this.buildUnitGroup()) : [],
      ),
    });
    const sub = allocGroup.get('quantity')!.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((qty) => this.syncUnitRows(allocGroup, qty ?? 1));
    this.allocationQuantitySubs.set(allocGroup, sub);
    return allocGroup;
  }

  private syncUnitRows(allocGroup: FormGroup, qty: number): void {
    const units = allocGroup.get('units') as FormArray;
    while (units.length < qty) units.push(this.buildUnitGroup());
    while (units.length > qty) units.removeAt(units.length - 1);
  }

  getUnits(itemIndex: number, allocIndex: number): FormArray {
    return (this.variantAllocations(itemIndex).at(allocIndex) as FormGroup).get('units') as FormArray;
  }

  subtotal(itemIndex: number): number {
    const item = this.items.at(itemIndex).value;
    return (item.price ?? 0) * (item.quantity ?? 0);
  }

  removeItem(index: number): void {
    const group = this.items.at(index) as FormGroup;
    this.itemQuantitySubs.get(group)?.unsubscribe();
    this.itemQuantitySubs.delete(group);
    this.itemProducts.delete(group);
    for (const allocGroup of (group.get('variants') as FormArray).controls as FormGroup[]) {
      this.allocationQuantitySubs.get(allocGroup)?.unsubscribe();
      this.allocationQuantitySubs.delete(allocGroup);
    }
    this.items.removeAt(index);
  }

  private clearItems(): void {
    // Unsubscribe all item + allocation subs before clearing
    for (const sub of this.itemQuantitySubs.values()) sub.unsubscribe();
    this.itemQuantitySubs.clear();
    for (const sub of this.allocationQuantitySubs.values()) sub.unsubscribe();
    this.allocationQuantitySubs.clear();
    this.itemProducts.clear();
    this.items.clear();
  }

  /** Converts a Date or date-string to local YYYY-MM-DD (no UTC shift). */
  private toYmd(d: unknown): string {
    if (d instanceof Date) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return String(d ?? '');
  }

  /** Validates that every item is resolved in Alegra, fully split across its variants, and has identifiers where required. Returns an error message or null. */
  private validateUnits(): string | null {
    for (let i = 0; i < this.items.length; i++) {
      const ig = this.items.at(i) as FormGroup;
      const iv = ig.value;

      if (!iv.alegraItemId) {
        return `El item "${this.productLabel(i)}" todavía no está creado en Alegra para esta bodega.`;
      }

      const allocations = this.variantAllocations(i);
      if (!allocations.length) {
        return `El item "${this.productLabel(i)}" necesita al menos una variante (color) seleccionada.`;
      }

      const allocated = this.allocatedQuantity(i);
      if (allocated !== (iv.quantity ?? 0)) {
        return `El item "${this.productLabel(i)}": repartiste ${allocated} de ${iv.quantity} unidades entre las variantes — deben sumar exactamente la cantidad total.`;
      }

      for (const allocGroup of allocations.controls as FormGroup[]) {
        const av = allocGroup.value;
        if (!av.productVariantId) {
          return `El item "${this.productLabel(i)}" tiene una variante sin color seleccionado.`;
        }

        if (!iv.hasIdentifier) continue; // Fungible product: only quantity matters, no per-unit data.

        const units = (allocGroup.get('units') as FormArray).controls;
        for (const ug of units) {
          const identifier = (ug.value.identifier || '').trim();
          if (!identifier) {
            return `El item "${this.productLabel(i)}" tiene unidades sin identificador (IMEI/serial) en una de sus variantes.`;
          }
        }
      }
    }
    return null;
  }

  private buildPayload(v: any) {
    return {
      store: v.store,
      providerId: v.providerId,
      providerName: v.providerName,
      providerIdentification: v.providerIdentification || undefined,
      date: this.toYmd(v.date),
      dueDate: this.toYmd(v.dueDate),
      alegraWarehouseId: v.alegraWarehouseId,
      alegraWarehouseName: v.alegraWarehouseName,
      warehouseId: v.warehouseId || undefined,
      observations: v.observations || undefined,
      // One FormGroup per PRODUCT can carry several color allocations — flatten each into its
      // own PurchaseOrderItem (same alegraItemId, different productVariantId/quantity/units),
      // matching what the backend already supports for multi-color entries of one product.
      items: this.items.controls.flatMap((ig, i) => {
        const iv = ig.value;
        const hasIdentifier = !!iv.hasIdentifier;

        return this.variantAllocations(i).controls.map((allocGroup) => {
          const av = allocGroup.value;
          const quantity = av.quantity ?? 0;
          const units: Array<{ identifier: string | null }> = hasIdentifier
            ? (allocGroup.get('units') as FormArray).controls.map((ug) => ({
                identifier: (ug.value.identifier || '').trim() || null,
              }))
            : [];

          return {
            alegraItemId: iv.alegraItemId,
            productVariantId: av.productVariantId,
            name: iv.name,
            price: iv.price,
            quantity,
            requiresSerial: hasIdentifier,
            units,
          };
        });
      }),
    };
  }

  // ─── Edit mode ─────────────────────────────────────────────────────────────

  private loadOrderForEdit(id: number): void {
    this.loadingOrder.set(true);
    this.service.findOne(id).subscribe({
      next: (res) => {
        const order = res.order ?? res;
        if (order.status !== 'draft') {
          this.messageService.add({
            severity: 'warn',
            summary: 'No editable',
            detail: 'Solo se pueden editar órdenes en borrador.',
          });
          this.router.navigate(['/inventario/purchase-orders', id]);
          return;
        }
        this.patchFormFromOrder(order);
        this.loadingOrder.set(false);
      },
      error: () => {
        this.loadingOrder.set(false);
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo cargar el borrador' });
        this.router.navigate(['/inventario/purchase-orders']);
      },
    });
  }

  private patchFormFromOrder(order: any): void {
    const parseDate = (s: string | null): Date | null =>
      s ? new Date(s + 'T00:00:00') : null;

    // Populate provider dropdown with the order's provider before patching
    if (order.provider) {
      const providerOpt: ProviderOption = {
        label: order.provider.name,
        value: order.provider_id ?? order.provider.alegra_id ?? order.provider.id,
        identification: order.provider.identification,
      };
      this.providers = [providerOpt];
    }

    // Populate warehouse dropdown. `order.warehouse` is the Alegra jsonb snapshot ({id, name} =
    // Alegra's own warehouse id) — the LOCAL warehouse UUID (needed to load its products) lives in
    // `order.warehouse_local`, a separate real FK relation.
    if (order.warehouse) {
      const whOpt: WarehouseOption = {
        label: order.warehouse.name,
        value: String(order.warehouse.id ?? order.alegra_warehouse_id ?? ''),
        warehouseId: order.warehouse_local?.id ?? order.warehouse_id,
      };
      this.warehouses = [whOpt];
    }

    this.form.patchValue({
      store: order.store,
      providerId: order.provider_id ?? order.provider?.alegra_id ?? order.provider?.id ?? null,
      providerName: order.provider?.name ?? '',
      providerIdentification: order.provider?.identification ?? '',
      date: parseDate(order.date),
      dueDate: parseDate(order.due_date ?? order.dueDate),
      alegraWarehouseId: String(order.warehouse?.id ?? order.alegra_warehouse_id ?? ''),
      alegraWarehouseName: order.warehouse?.name ?? order.alegra_warehouse_name ?? '',
      warehouseId: order.warehouse_local?.id ?? order.warehouse_id ?? '',
      observations: order.observations ?? '',
    });

    // Store is set → enable the dependent controls (they start disabled).
    if (order.store) {
      this.form.get('providerId')?.enable();
      this.form.get('alegraWarehouseId')?.enable();
      const seq = ++this.requestSeq;
      this.loadInitialProviders(order.store, seq);
      this.loadWarehouses(order.store, seq);
    }

    const warehouseId: string | undefined = order.warehouse_local?.id ?? order.warehouse_id;
    if (warehouseId) {
      this.loadProductsForWarehouse(warehouseId);
    }

    // Rebuild items FormArray from the saved order — items are already resolved in Alegra, so
    // they're reconstructed directly (no product picker needed for existing rows). The backend
    // stores one flat entry PER COLOR (same alegraItemId, different productVariantId) — group
    // them back into one product row with several variant allocations.
    this.clearItems();
    const orderItems: any[] = order.items ?? [];
    const grouped = new Map<number, any[]>();
    for (const item of orderItems) {
      const alegraItemId = item.alegra_item_id ?? item.alegraItemId;
      if (!grouped.has(alegraItemId)) grouped.set(alegraItemId, []);
      grouped.get(alegraItemId)!.push(item);
    }

    for (const [alegraItemId, rows] of grouped) {
      const first = rows[0];
      const hasIdentifier = !!first.requiresSerial;
      const totalQuantity = rows.reduce((sum, r) => sum + (r.quantity ?? 0), 0);

      const allocationGroups = rows.map((row) => {
        const units: any[] = row.units ?? [];
        const allocGroup = this.fb.group({
          productVariantId: [row.productVariantId ?? row.product_variant_id ?? null, Validators.required],
          quantity: [row.quantity, [Validators.required, Validators.min(1)]],
          units: this.fb.array(
            units.map((u: any) => this.fb.group({ identifier: [u.identifier ?? ''] })),
          ),
        });
        const sub = allocGroup.get('quantity')!.valueChanges
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((qty) => this.syncUnitRows(allocGroup, qty ?? 1));
        this.allocationQuantitySubs.set(allocGroup, sub);
        return allocGroup;
      });

      const itemGroup = this.fb.group({
        alegraItemId: [alegraItemId, Validators.required],
        name: [first.name],
        price: [first.price, [Validators.required, Validators.min(1)]],
        quantity: [totalQuantity, [Validators.required, Validators.min(1)]],
        hasIdentifier: [hasIdentifier],
        variants: this.fb.array(allocationGroups),
      });

      const sub = itemGroup.get('quantity')!.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((qty) => this.onItemQuantityChange(itemGroup, qty ?? 1));
      this.itemQuantitySubs.set(itemGroup, sub);

      this.items.push(itemGroup);
    }
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  saveDraft(): void {
    if (!this.form.value.store) {
      this.messageService.add({ severity: 'warn', summary: 'Requerido', detail: 'Seleccioná una tienda.' });
      return;
    }

    this.savingDraft.set(true);

    if (this.editMode && this.editOrderId) {
      this.service.updateDraft(this.editOrderId, this.buildPayload(this.form.value)).subscribe({
        next: () => {
          this.savingDraft.set(false);
          this.messageService.add({ severity: 'success', summary: 'Borrador actualizado' });
          this.router.navigate(['/inventario/purchase-orders']);
        },
        error: (err) => {
          this.savingDraft.set(false);
          const detail = err.error?.message ?? 'Error al guardar el borrador';
          this.messageService.add({ severity: 'error', summary: 'Error', detail });
        },
      });
    } else {
      this.service.createDraft(this.buildPayload(this.form.value)).subscribe({
        next: () => {
          this.savingDraft.set(false);
          this.messageService.add({ severity: 'success', summary: 'Borrador guardado' });
          this.router.navigate(['/inventario/purchase-orders']);
        },
        error: (err) => {
          this.savingDraft.set(false);
          const detail = err.error?.message ?? 'Error al guardar el borrador';
          this.messageService.add({ severity: 'error', summary: 'Error', detail });
        },
      });
    }
  }

  submitDraftToAlegra(): void {
    const v = this.form.value;
    this.submitAttempted = true;
    if (!v.store || !v.providerId || !v.alegraWarehouseId || this.items.length === 0) {
      this.form.markAllAsTouched();
      this.messageService.add({
        severity: 'warn',
        summary: 'Formulario incompleto',
        detail: 'Tienda, proveedor y bodega son obligatorios para enviar a Alegra.',
      });
      return;
    }
    if (!this.editOrderId) return;

    const unitError = this.validateUnits();
    if (unitError) {
      this.messageService.add({ severity: 'warn', summary: 'Datos incompletos', detail: unitError });
      return;
    }

    this.submittingToAlegra.set(true);
    this.service.updateDraft(this.editOrderId, this.buildPayload(v)).subscribe({
      next: () => {
        this.service.submitDraft(this.editOrderId!).subscribe({
          next: (order) => {
            this.submittingToAlegra.set(false);
            if (order.status === 'serial_duplicated') {
              this.messageService.add({
                severity: 'warn',
                summary: 'Enviado con seriales duplicados',
                detail: 'Revisá el detalle para ver los IMEIs duplicados.',
                life: 8000,
              });
            } else {
              this.messageService.add({
                severity: 'success',
                summary: 'Orden enviada a Alegra',
                detail: `ID Alegra: ${order.alegra_id}`,
              });
            }
            this.router.navigate(['/inventario/purchase-orders', this.editOrderId]);
          },
          error: (err) => {
            this.submittingToAlegra.set(false);
            const detail = err.error?.message ?? 'Error al enviar a Alegra';
            this.messageService.add({ severity: 'error', summary: 'Error', detail, life: 8000 });
          },
        });
      },
      error: (err) => {
        this.submittingToAlegra.set(false);
        const detail = err.error?.message ?? 'Error al guardar antes de enviar';
        this.messageService.add({ severity: 'error', summary: 'Error', detail, life: 8000 });
      },
    });
  }

  submit(): void {
    this.submitAttempted = true;
    const v = this.form.value;

    if (!v.store || !v.providerId || !v.alegraWarehouseId || this.items.length === 0) {
      this.form.markAllAsTouched();
      this.messageService.add({
        severity: 'warn',
        summary: 'Formulario incompleto',
        detail: 'Tienda, proveedor y bodega son obligatorios para crear la orden.',
      });
      return;
    }

    if (!this.form.valid) {
      this.form.markAllAsTouched();
      this.messageService.add({
        severity: 'warn',
        summary: 'Formulario inválido',
        detail: 'Revisá los campos marcados en rojo.',
      });
      return;
    }

    const hasInvalidItems = this.items.controls.some((c) => {
      const iv = c.value;
      return (iv.quantity ?? 0) < 1 || (iv.price ?? 0) < 1;
    });
    if (hasInvalidItems) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Items inválidos',
        detail: 'Cada item debe tener cantidad ≥ 1 y precio ≥ $1.',
      });
      return;
    }

    const unitError = this.validateUnits();
    if (unitError) {
      this.messageService.add({ severity: 'warn', summary: 'Datos incompletos', detail: unitError });
      return;
    }

    this.submitting.set(true);
    this.service.create(this.buildPayload(v)).subscribe({
      next: (order) => {
        this.submitting.set(false);
        if (order.status === 'serial_duplicated') {
          this.messageService.add({
            severity: 'warn',
            summary: 'Orden creada con seriales duplicados',
            detail: 'Revisá el detalle de la orden para ver qué IMEIs estaban duplicados.',
            life: 8000,
          });
        } else {
          this.messageService.add({
            severity: 'success',
            summary: 'Orden creada',
            detail: `ID Alegra: ${order.alegra_id}`,
          });
        }
        this.router.navigate(['/inventario/purchase-orders']);
      },
      error: (err) => {
        this.submitting.set(false);
        const detail = err.error?.message ?? err.message ?? 'Error al crear la orden';
        this.messageService.add({ severity: 'error', summary: 'Error', detail, life: 8000 });
      },
    });
  }
}
