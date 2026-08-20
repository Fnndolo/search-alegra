import { Component, OnInit, signal, inject, DestroyRef, ChangeDetectorRef, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { MessageService } from 'primeng/api';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';

import { ButtonModule } from 'primeng/button';
import { DropdownModule, Dropdown } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CalendarModule } from 'primeng/calendar';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { DividerModule } from 'primeng/divider';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import { PurchaseOrdersService } from '../purchase-orders.service';
import { InventoryApiService, ProductForWarehouse } from '../../services/inventory-api.service';
import { BarcodeScannerModalComponent } from '../../shared/barcode-scanner-modal/barcode-scanner-modal.component';
import { ColorPickerComponent, ColorSelectedEvent } from '../../inventory-dashboard/color-picker/color-picker.component';
import { Color } from '../../models/inventory.models';

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
    FormsModule,
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
    TooltipModule,
    BarcodeScannerModalComponent,
    ColorPickerComponent,
  ],
  providers: [MessageService],
  templateUrl: './create-order.component.html',
})
export class CreateOrderComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  /** Reference to the product `p-dropdown` — needed to reset/close it after a barcode-scanner
   *  Enter resolves to an exact SKU match (see onProductDropdownEnter). */
  @ViewChild('productPicker') productPickerRef?: Dropdown;
  /** Mirrors the dropdown's own filter box text (via its public onFilter event) so a scanner's
   *  Enter can be matched against it without touching any undocumented internal state. */
  productFilterText = '';

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
  /** Store key the initial provider load was last kicked off for — prevents onStoreChange and
   *  ensureProvidersLoaded from firing a duplicate request for the same store (see the latter). */
  private providersRequestedForStore: string | null = null;
  /** Per-item-group subscriptions for total-quantity → single-allocation sync (see `onItemQuantityChange`). */
  private readonly itemQuantitySubs = new Map<FormGroup, Subscription>();
  /** Per-allocation-group subscriptions for quantity → unit (IMEI) row sync. */
  private readonly allocationQuantitySubs = new Map<FormGroup, Subscription>();
  /** Source product behind each item row — drives the per-allocation variant dropdowns. */
  private readonly itemProducts = new Map<FormGroup, ProductForWarehouse>();

  /** Item row index whose "crear variante nueva" inline form is open (null = none open). */
  creatingVariantForItem: number | null = null;
  newVariantColorId: string | null = null;
  newVariantPreview: Color | null = null;
  newVariantSku = '';
  creatingVariant = false;

  stores: StoreOption[] = [];
  providers: ProviderOption[] = [];
  warehouses: WarehouseOption[] = [];
  productOptions: ProductOption[] = [];
  /** True once products were loaded for the selected warehouse and the list came back empty. */
  noProductsForWarehouse = false;

  /** Shared camera-scanner modal state — `scannerMode` decides what a successful scan does with the code. */
  scannerVisible = false;
  scannerHeader = 'Escanear código';
  /** Icon + color for the on-camera banner — kept in lockstep with `scannerMode` so it's obvious
   *  at a glance, without reading text, whether the next scan is a product SKU or a unit IMEI. */
  scannerBadgeIcon = 'pi pi-barcode';
  scannerBadgeColor: 'primary' | 'amber' = 'primary';
  /** True only for the main "scan a product" entry point — chains SKU → IMEI → SKU without
   *  closing the camera. The per-unit camera button (one specific IMEI field) stays single-shot. */
  scannerContinuous = false;
  private scannerMode: 'product' | 'unit' | null = null;
  private scannerUnitTarget: { itemIndex: number; allocIndex: number; unitIndex: number } | null = null;

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
    this.providersRequestedForStore = null;
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
    this.providersRequestedForStore = storeKey;
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

  /**
   * Safety net: load providers when the dropdown opens, in case the store-change trigger was
   * missed. Guarded by `providersRequestedForStore` (not just `!providers.length`) — without it,
   * opening the dropdown while onStoreChange's own request is still in flight fired a SECOND
   * request with a newer `requestSeq`, which made the first request's response get discarded by
   * the sequence check in `loadInitialProviders` — the list only populated once this second,
   * redundant round-trip resolved (perceived as "sometimes doesn't load, closing and reopening
   * fixes it").
   */
  ensureProvidersLoaded(): void {
    const store = this.form.value.store;
    if (store && !this.providers.length && this.providersRequestedForStore !== store) {
      this.providersRequestedForStore = store;
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

  /**
   * A physical barcode reader just types the code into whatever input is focused and then sends
   * Enter (it's a keyboard-emulating HID device, not a click/arrow-key selection) — so it lands in
   * the SAME product-search dropdown used for manual typing, instead of a separate field.
   *
   * PrimeNG's own Enter handling for `p-dropdown[filter]` only selects a HIGHLIGHTED option (via
   * arrow keys or mouse hover first) — a scanner never highlights anything, it just types+Enters,
   * so relying on that native selection is unreliable. Instead: `productFilterText` mirrors the
   * dropdown's filter box via its PUBLIC `(onFilter)` event (searchProducts), and this handler
   * matches THAT text against every loaded SKU directly (matchAndAddProductBySku) — completely
   * independent of whatever PrimeNG's internal highlight/selection state happens to be. If it's
   * not an exact SKU match (e.g. the user is mid-typing a name to search manually), nothing is
   * intercepted and the dropdown's native filter/click-to-select behavior is left untouched.
   */
  onProductDropdownEnter(event: Event): void {
    const code = this.productFilterText.trim();
    if (!code) return;

    const target = this.matchAndAddProductBySku(code);
    if (!target) return; // no exact SKU match — let the dropdown keep behaving normally.

    event.preventDefault();
    this.productFilterText = '';
    this.productPickerRef?.writeValue(null);
    this.productPickerRef?.resetFilter();
    this.productPickerRef?.hide();

    if (target.unitIndex !== null) {
      this.focusImeiField(target.itemIndex, target.allocIndex, target.unitIndex);
    }
  }

  /**
   * Enter on an IMEI/serial field (typed by hand or by a barcode reader): jumps to the next
   * IMEI/serial input in visual order — the classic "scan gun" data-entry flow, so a whole box of
   * units can be entered as scan-Enter-scan-Enter without touching the mouse. Loops back to the
   * product dropdown once the last field is reached, ready to scan the next product's SKU.
   */
  onImeiEnter(event: Event): void {
    event.preventDefault();
    const current = event.target as HTMLInputElement;
    const fields = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-imei-key]'));
    const idx = fields.indexOf(current);
    const next = idx >= 0 ? fields[idx + 1] : undefined;
    if (next) {
      next.focus();
      next.select();
    } else {
      this.productPickerRef?.focus();
    }
  }

  /** Focuses the identifier input for a specific (itemIndex, allocIndex, unitIndex) unit, once
   *  Angular has actually rendered it (it may be a brand-new row from this same scan). */
  private focusImeiField(itemIndex: number, allocIndex: number, unitIndex: number): void {
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(
        `input[data-imei-key="${itemIndex}-${allocIndex}-${unitIndex}"]`,
      );
      el?.focus();
      el?.select();
    });
  }

  /**
   * Opens the shared camera-scanner modal to look up a product by SKU among the ones already
   * loaded for this warehouse. Runs in continuous mode: a matched SKU adds/bumps that exact color
   * variant, and — for products that require one — immediately chains into scanning the IMEI for
   * the unit it just created, then flips back to expecting the next SKU. The camera never closes
   * in between, so a whole box of mixed products/colors can be entered as one scan-scan-scan run.
   */
  openProductScanner(): void {
    this.scannerMode = 'product';
    this.scannerHeader = 'Escaneando SKU del producto';
    this.scannerBadgeIcon = 'pi pi-barcode';
    this.scannerBadgeColor = 'primary';
    this.scannerContinuous = true;
    this.scannerVisible = true;
  }

  /** Opens the shared camera-scanner modal to fill ONE specific unit's identifier (IMEI/serial) — single shot, closes after the scan. */
  openUnitScanner(itemIndex: number, allocIndex: number, unitIndex: number): void {
    this.scannerMode = 'unit';
    this.scannerHeader = 'Escaneando IMEI / serial';
    this.scannerBadgeIcon = 'pi pi-mobile';
    this.scannerBadgeColor = 'amber';
    this.scannerContinuous = false;
    this.scannerUnitTarget = { itemIndex, allocIndex, unitIndex };
    this.scannerVisible = true;
  }

  onBarcodeScanned(code: string): void {
    if (this.scannerMode === 'product') {
      this.matchAndAddProductBySku(code);
      return; // keeps scannerMode/target — matchAndAddProductBySku decides the next mode itself.
    }
    if (this.scannerMode === 'unit' && this.scannerUnitTarget) {
      const { itemIndex, allocIndex, unitIndex } = this.scannerUnitTarget;
      this.getUnits(itemIndex, allocIndex).at(unitIndex)?.get('identifier')?.setValue(code);

      if (this.scannerContinuous) {
        // Chained from a SKU scan — that unit's IMEI is filled, go back to expecting the next SKU.
        this.messageService.add({ severity: 'success', summary: 'IMEI cargado', detail: code, life: 2000 });
        this.scannerMode = 'product';
        this.scannerHeader = 'Escaneando SKU del producto';
        this.scannerBadgeIcon = 'pi pi-barcode';
        this.scannerBadgeColor = 'primary';
        this.scannerUnitTarget = null;
        return;
      }
    }
    this.scannerMode = null;
    this.scannerUnitTarget = null;
  }

  /**
   * Matches a scanned code against the SKUs of every variant of every product already listed for
   * this warehouse (case-insensitive, trimmed). Returns where the matched unit landed (so a caller
   * can chain into focusing/scanning its IMEI), or null if nothing matched.
   */
  private matchAndAddProductBySku(
    code: string,
  ): { itemIndex: number; allocIndex: number; unitIndex: number | null } | null {
    const normalized = code.trim().toLowerCase();
    let matchedProduct: ProductForWarehouse | undefined;
    let matchedVariantId: string | undefined;
    for (const option of this.productOptions) {
      const v = option.product.variants.find((v) => v.sku.trim().toLowerCase() === normalized);
      if (v) {
        matchedProduct = option.product;
        matchedVariantId = v.id;
        break;
      }
    }
    if (!matchedProduct || !matchedVariantId) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Sin coincidencia',
        detail: `Ningún producto de esta bodega tiene el SKU "${code}".`,
        life: 5000,
      });
      return null; // stays in 'product' mode — camera/scanner input is still live for a retry.
    }

    const variant = matchedProduct.variants.find((v) => v.id === matchedVariantId)!;
    const target = this.addOrIncrementVariant(matchedProduct, matchedVariantId);

    this.messageService.add({
      severity: 'success',
      summary: 'Producto agregado',
      detail: `${matchedProduct.productName}${variant.color?.name ? ' — ' + variant.color.name : ''}`,
      life: 2000,
    });

    if (this.scannerContinuous && target.unitIndex !== null) {
      // This product requires an identifier — chain straight into scanning the IMEI for the
      // unit this scan just created, without closing the camera.
      this.scannerMode = 'unit';
      this.scannerHeader = 'Escaneando IMEI / serial';
      this.scannerBadgeIcon = 'pi pi-mobile';
      this.scannerBadgeColor = 'amber';
      this.scannerUnitTarget = { itemIndex: target.itemIndex, allocIndex: target.allocIndex, unitIndex: target.unitIndex };
    }
    // Fungible product (no identifier): stays in 'product' mode, ready for the next SKU scan.
    return target;
  }

  /**
   * Adds the scanned variant to the order — as a brand-new product row if this is the first time
   * this product is scanned, as a new color allocation if the product's already in the order but
   * this color isn't yet, or by bumping an existing allocation's quantity by 1 (auto-adding one
   * empty unit row) if this exact color was already scanned before. Returns where that unit landed
   * so the caller can chain into scanning its IMEI.
   */
  private addOrIncrementVariant(
    product: ProductForWarehouse,
    variantId: string,
  ): { itemIndex: number; allocIndex: number; unitIndex: number | null } {
    const hasIdentifier = product.hasIdentifier;
    const itemIndex = this.items.controls.findIndex(
      (c) => this.itemProducts.get(c as FormGroup)?.productId === product.productId,
    );

    if (itemIndex === -1) {
      this.addProduct({ label: product.productName, value: product.productId, product, skus: '' }, variantId);
      const newIndex = this.items.length - 1;
      return {
        itemIndex: newIndex,
        allocIndex: 0,
        unitIndex: hasIdentifier ? this.getUnits(newIndex, 0).length - 1 : null,
      };
    }

    const itemGroup = this.items.at(itemIndex) as FormGroup;
    const allocations = this.variantAllocations(itemIndex);
    let allocIndex = allocations.controls.findIndex((c) => c.get('productVariantId')?.value === variantId);

    if (allocIndex === -1) {
      allocations.push(this.buildVariantAllocationGroup(variantId, 1, hasIdentifier));
      allocIndex = allocations.length - 1;
    } else {
      const allocGroup = allocations.at(allocIndex) as FormGroup;
      const newQty = (allocGroup.get('quantity')?.value ?? 0) + 1;
      allocGroup.get('quantity')?.setValue(newQty); // triggers syncUnitRows → adds one empty unit row
    }
    // Keep the item's total in sync without re-triggering onItemQuantityChange's single-allocation
    // auto-resize (it would just re-set the same value, but emitEvent:false avoids the extra cycle).
    itemGroup.get('quantity')?.setValue(this.allocatedQuantity(itemIndex), { emitEvent: false });

    return {
      itemIndex,
      allocIndex,
      unitIndex: hasIdentifier ? this.getUnits(itemIndex, allocIndex).length - 1 : null,
    };
  }

  searchProducts(event: any): void {
    // Tracked so a barcode-scanner Enter (onProductDropdownEnter) can read exactly what's
    // currently typed in the dropdown's own filter box, via PrimeNG's public onFilter event —
    // no reliance on any internal/undocumented dropdown state.
    this.productFilterText = event.filter ?? '';
    const warehouseId = this.form.value.warehouseId;
    if (!warehouseId) return;
    this.loadProductsForWarehouse(warehouseId, event.filter);
  }

  addProduct(option: ProductOption | null, preferredVariantId?: string): void {
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

    const defaultVariant =
      (preferredVariantId ? product.variants.find((v) => v.id === preferredVariantId) : null) ??
      product.variants[0] ?? null;
    const firstAllocation = this.buildVariantAllocationGroup(defaultVariant?.id ?? null, 1, product.hasIdentifier);

    const itemGroup = this.fb.group({
      // alegraItemId can be null here — the product was never published in this warehouse yet.
      // The backend auto-creates the Alegra item (and resolves this id) when the order is submitted.
      alegraItemId: [product.alegra.alegraItemId],
      productId: [product.productId, Validators.required],
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

  /** Whether this line already has an Alegra item, or will be auto-created on submit (see resolveItemAlegraIds on the backend). */
  isPublishedInAlegra(index: number): boolean {
    return !!this.items.at(index).get('alegraItemId')?.value;
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
        hexCode: v.color?.hexCode ?? (v.color as any)?.hex_code ?? null,
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

  /**
   * "Sin más colores" (addVariantAllocation) or just wanting a brand-new color/SKU that doesn't
   * exist yet for this product — opens the inline create-variant form, reusing the same
   * app-color-picker (dropdown + "Crear nuevo") used everywhere else a color variant is created.
   */
  openCreateVariant(itemIndex: number): void {
    this.creatingVariantForItem = itemIndex;
    this.newVariantColorId = null;
    this.newVariantPreview = null;
    this.newVariantSku = '';
  }

  cancelCreateVariant(): void {
    this.creatingVariantForItem = null;
  }

  onNewVariantColorSelected(event: ColorSelectedEvent): void {
    this.newVariantColorId = event.colorId;
    this.newVariantPreview = event.preview;
  }

  saveNewVariant(itemIndex: number): void {
    const itemGroup = this.items.at(itemIndex) as FormGroup;
    const product = this.itemProducts.get(itemGroup);
    if (!product) return;

    const sku = this.newVariantSku.trim();
    if (!this.newVariantColorId || !sku) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Datos incompletos',
        detail: 'Elegí (o creá) un color y escribí el SKU',
      });
      return;
    }
    if (product.variants.some((v) => v.sku.trim().toLowerCase() === sku.toLowerCase())) {
      this.messageService.add({
        severity: 'warn',
        summary: 'SKU repetido',
        detail: `${product.productName} ya tiene una variante con el SKU '${sku}'`,
      });
      return;
    }

    this.creatingVariant = true;
    this.inventoryApi.createProductVariant(product.productId, { colorId: this.newVariantColorId, sku }).subscribe({
      next: (created) => {
        this.creatingVariant = false;
        // Same object reference `itemProducts` holds — variantOptionsFor sees the new variant
        // immediately without needing to reload the product.
        product.variants = [...product.variants, { id: created.id, color: created.color, sku: created.sku }];

        const allocations = this.variantAllocations(itemIndex);
        const remaining = this.remainingQuantity(itemIndex);
        const hasIdentifier = !!itemGroup.get('hasIdentifier')?.value;
        let newQty: number;
        if (remaining > 0) {
          newQty = remaining;
        } else {
          const controls = allocations.controls as FormGroup[];
          if (controls.length) {
            const donor = controls.reduce((biggest, c) =>
              (c.get('quantity')?.value ?? 0) > (biggest.get('quantity')?.value ?? 0) ? c : biggest,
            );
            donor.get('quantity')?.setValue(Math.max(1, (donor.get('quantity')?.value ?? 1) - 1));
          }
          newQty = 1;
        }
        allocations.push(this.buildVariantAllocationGroup(created.id, newQty, hasIdentifier));

        this.creatingVariantForItem = null;
        this.messageService.add({
          severity: 'success',
          summary: 'Variante creada',
          detail: `${created.color?.name ?? 'Sin color'} — ${created.sku}`,
        });
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.creatingVariant = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo crear la variante' });
        this.cdr.markForCheck();
      },
    });
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

      if (!iv.productId) {
        return `El item "${this.productLabel(i)}" no tiene producto asociado.`;
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
            productId: iv.productId,
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
    const grouped = new Map<string, any[]>();
    for (const item of orderItems) {
      const alegraItemId = item.alegra_item_id ?? item.alegraItemId;
      const productId = item.product_id ?? item.productId;
      // Draft rows for products never published yet all share the same alegraItemId sentinel (0) —
      // group by productId in that case so distinct unpublished products don't collapse into one row.
      const groupKey = alegraItemId ? `alegra:${alegraItemId}` : `product:${productId}`;
      if (!grouped.has(groupKey)) grouped.set(groupKey, []);
      grouped.get(groupKey)!.push(item);
    }

    for (const rows of grouped.values()) {
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
        // Falsy/0 while the product was still unpublished when this draft was saved — resolved
        // server-side on submit, so it's not required here.
        alegraItemId: [first.alegra_item_id ?? first.alegraItemId ?? null],
        productId: [first.product_id ?? first.productId ?? null, Validators.required],
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
    if (this.savingDraft() || this.submitting() || this.submittingToAlegra()) return;
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
    if (this.savingDraft() || this.submitting() || this.submittingToAlegra()) return;
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
    if (this.savingDraft() || this.submitting() || this.submittingToAlegra()) return;
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
