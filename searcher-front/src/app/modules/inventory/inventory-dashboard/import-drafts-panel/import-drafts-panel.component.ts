import { Component, Input, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { PaginatorModule } from 'primeng/paginator';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { MessageService } from 'primeng/api';
import { Subject, forkJoin } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { InventoryApiService } from '../../services/inventory-api.service';
import { Categoria, Color, ImportDraftStatus, ProductImportDraft, Sede } from '../../models/inventory.models';
import { ColorPickerComponent, ColorSelectedEvent } from '../color-picker/color-picker.component';
import { BarcodeScannerModalComponent } from '../../shared/barcode-scanner-modal/barcode-scanner-modal.component';

interface DraftVariantRow {
  color?: string;
  colorId?: string;
  preview: Color | null;
  sku: string;
}

interface DraftEditState {
  categoryId: string | null;
  variants: DraftVariantRow[];
  salePrice: number | null;
  hasIdentifier: boolean;
  negativeSell: boolean;
}


interface PendingUnitRow {
  identifier: string;
}

interface UnitVariantRow {
  variantId: string;
  color: Color | null;
  sku: string;
  pending: PendingUnitRow[];
}


interface UnitImportState {
  loading: boolean;
  submitting: boolean;
  sedeId: string | null;
  bodegaId: string | null;
  createdCount: number | null;
  variants: UnitVariantRow[];
  scanValue: string;
  creatingVariant: boolean;
  newVariantColorId: string | null;
  newVariantPreview: Color | null;
  newVariantSku: string;
}

@Component({
  selector: 'app-import-drafts-panel',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ButtonModule, DropdownModule,
    InputTextModule, InputNumberModule, ToggleSwitchModule, TagModule, ToastModule,
    PaginatorModule, IconFieldModule, InputIconModule, CheckboxModule,
    ColorPickerComponent, BarcodeScannerModalComponent,
  ],
  providers: [MessageService],
  templateUrl: './import-drafts-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportDraftsPanelComponent {
  @Input() sedes: Sede[] = [];
  @Input() categorias: Categoria[] = [];

  selectedStoreKey: string | null = null;
  drafts: ProductImportDraft[] = [];
  loadingDrafts = false;
  syncingCache = false;
  generatingDrafts = false;
  importingId: string | null = null;

  // ── Search / status filter / pagination ────────────────
  searchValue = '';
  private searchSubject = new Subject<string>();
  statusFilter: ImportDraftStatus | null = null;
  statusOptions = [
    { label: 'Todos', value: null },
    { label: 'Pendientes', value: 'pending' },
    { label: 'Configurados', value: 'configured' },
    { label: 'Importados', value: 'imported' },
  ];
  /** "Cantidad en existencia" — solo cacheados con available_quantity real (Alegra reportó > 0). */
  stockFilter = false;
  page = 0;
  rows = 30;
  totalDrafts = 0;
  counts: { pending: number; configured: number; imported: number; total: number } | null = null;

  /** Bodega name per id for the selected sede, so drafts can show which bodega they resolved to. */
  private warehouseNames = new Map<string, string>();

  constructor(
    private readonly api: InventoryApiService,
    private readonly messageService: MessageService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.searchSubject.pipe(debounceTime(350), distinctUntilChanged()).subscribe(() => {
      this.page = 0;
      this.loadDrafts();
    });
  }

  onStoreChange(): void {
    this.drafts = [];
    this.counts = null;
    this.page = 0;
    this.searchValue = '';
    this.statusFilter = null;
    this.stockFilter = false;
    this.warehouseNames = new Map();
    if (this.selectedStoreKey) {
      this.loadDrafts();
      this.loadCounts();
      this.loadWarehouseNames(this.selectedStoreKey);
    }
  }

  private loadWarehouseNames(storeKey: string): void {
    this.api.getBodegasByStoreKey(storeKey).subscribe({
      next: (bodegas) => {
        this.warehouseNames = new Map(bodegas.map((b) => [b.id, b.nombre]));
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  /** Bodega resuelta para el item cacheado detrás de este draft, o null si no se pudo vincular. */
  warehouseNameFor(draft: ProductImportDraft): string | null {
    const warehouseId = draft.alegra_product_cache?.warehouse_id;
    if (!warehouseId) return null;
    return this.warehouseNames.get(warehouseId) ?? null;
  }

  onSearchChange(): void {
    this.searchSubject.next(this.searchValue);
  }

  onStatusFilterChange(): void {
    this.page = 0;
    this.loadDrafts();
  }

  onStockFilterChange(): void {
    this.page = 0;
    this.loadDrafts();
  }

  onPageChange(event: { first?: number; rows?: number }): void {
    const rows = event.rows ?? this.rows;
    this.page = Math.floor((event.first ?? 0) / rows);
    this.rows = rows;
    this.loadDrafts();
  }

  loadCounts(): void {
    if (!this.selectedStoreKey) return;
    this.api.getImportDraftsCounts(this.selectedStoreKey).subscribe({
      next: (c) => { this.counts = c; this.cdr.markForCheck(); },
      error: () => {},
    });
  }

  loadDrafts(): void {
    if (!this.selectedStoreKey) return;
    this.loadingDrafts = true;
    this.api.getImportDrafts({
      storeKey: this.selectedStoreKey,
      status: this.statusFilter ?? undefined,
      search: this.searchValue.trim() || undefined,
      hasStock: this.stockFilter || undefined,
      page: this.page,
      limit: this.rows,
    }).subscribe({
      next: (res) => {
        this.loadingDrafts = false;
        this.drafts = res.data;
        this.totalDrafts = res.total;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingDrafts = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar los borradores' });
        this.cdr.markForCheck();
      },
    });
  }

  syncCache(): void {
    if (!this.selectedStoreKey) return;
    this.syncingCache = true;
    this.api.syncAlegraCache(this.selectedStoreKey).subscribe({
      next: () => {
        this.syncingCache = false;
        this.messageService.add({ severity: 'success', summary: 'Cache de Alegra actualizado' });
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.syncingCache = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo sincronizar el cache' });
        this.cdr.markForCheck();
      },
    });
  }

  generateDrafts(): void {
    if (!this.selectedStoreKey) return;
    this.generatingDrafts = true;
    this.api.generateImportDrafts(this.selectedStoreKey).subscribe({
      next: () => {
        this.generatingDrafts = false;
        this.messageService.add({ severity: 'success', summary: 'Borradores generados' });
        this.page = 0;
        this.loadDrafts();
        this.loadCounts();
      },
      error: (e) => {
        this.generatingDrafts = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudieron generar los borradores' });
        this.cdr.markForCheck();
      },
    });
  }

  /** Local editable copy per draft, keyed by id — avoids mutating the list item until saved. */
  private editState = new Map<string, DraftEditState>();

  editFor(draft: ProductImportDraft): DraftEditState {
    let state = this.editState.get(draft.id);
    if (!state) {
      const existingVariants = draft.variants?.length
        ? draft.variants.map((v) => ({
            color: v.color, sku: v.sku,
            preview: { id: '', name: v.color, hexCode: null } as Color,
          }))
        : [{ preview: null, sku: draft.suggested_sku ?? '' }];
      state = {
        categoryId: draft.category_id,
        variants: existingVariants,
        salePrice: draft.sale_price,
        hasIdentifier: draft.has_identifier ?? false,
        negativeSell: draft.negative_sell ?? false,
      };
      this.editState.set(draft.id, state);
    }
    return state;
  }

  addVariantRow(draft: ProductImportDraft): void {
    this.editFor(draft).variants.push({ preview: null, sku: '' });
  }

  removeVariantRow(draft: ProductImportDraft, index: number): void {
    const state = this.editFor(draft);
    if (state.variants.length <= 1) return;
    state.variants.splice(index, 1);
  }

  onDraftColorSelected(draft: ProductImportDraft, index: number, event: ColorSelectedEvent) {
    const row = this.editFor(draft).variants[index];
    // Drafts only store a free-text color name on save (find-or-create happens at import time) —
    // the picker always resolves to a real color now, so its name is the value we keep.
    row.color = event.preview.name;
    row.colorId = event.colorId;
    row.preview = event.preview;
  }

  saving: Record<string, boolean> = {};

  private validateVariants(state: DraftEditState): string | null {
    if (!state.variants.length) return 'Agregá al menos una variante';
    const skus = new Set<string>();
    for (const v of state.variants) {
      if (!v.color?.trim() || !v.sku?.trim()) return 'Todas las variantes deben tener color y SKU';
      const sku = v.sku.trim();
      if (skus.has(sku)) return `El SKU '${sku}' está repetido`;
      skus.add(sku);
    }
    return null;
  }

  /** Validates the edit state and builds the update payload, or shows the corresponding warning
   *  toast and returns null. Shared by saveDraft (guardar solo) and importDraft (guardar + importar
   *  en un solo click) so both enforce the exact same rules. */
  private buildDraftUpdatePayload(draft: ProductImportDraft): {
    categoryId: string;
    variants: { color: string; sku: string }[];
    salePrice?: number;
    hasIdentifier: boolean;
    negativeSell: boolean;
  } | null {
    const state = this.editFor(draft);
    if (!state.categoryId) {
      this.messageService.add({ severity: 'warn', summary: 'Datos incompletos', detail: 'La categoría es obligatoria.' });
      return null;
    }
    const variantsError = this.validateVariants(state);
    if (variantsError) {
      this.messageService.add({ severity: 'warn', summary: 'Variantes inválidas', detail: variantsError });
      return null;
    }
    return {
      categoryId: state.categoryId,
      variants: state.variants.map((v) => ({ color: v.color!.trim(), sku: v.sku.trim() })),
      salePrice: state.salePrice ?? undefined,
      hasIdentifier: state.hasIdentifier,
      negativeSell: state.negativeSell,
    };
  }

  saveDraft(draft: ProductImportDraft): void {
    const payload = this.buildDraftUpdatePayload(draft);
    if (!payload) return;

    this.saving[draft.id] = true;
    this.api.updateImportDraft(draft.id, payload).subscribe({
      next: (updated) => {
        this.saving[draft.id] = false;
        const idx = this.drafts.findIndex((d) => d.id === draft.id);
        if (idx !== -1) this.drafts[idx] = updated;
        this.messageService.add({ severity: 'success', summary: 'Borrador configurado' });
        this.loadCounts();
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.saving[draft.id] = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo guardar el borrador' });
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Saves the current configuration and imports right away, in the same click — the common case
   * doesn't need "guardar, después importar" as two separate steps. "Guardar configuración" stays
   * available on its own for when you only want to save progress without importing yet.
   */
  importDraft(draft: ProductImportDraft): void {
    const payload = this.buildDraftUpdatePayload(draft);
    if (!payload) return;

    this.importingId = draft.id;
    this.api.updateImportDraft(draft.id, payload).subscribe({
      next: () => {
        this.api.importDraft(draft.id).subscribe({
          next: () => {
            this.importingId = null;
            this.editState.delete(draft.id);
            this.messageService.add({ severity: 'success', summary: 'Producto importado' });
            this.loadDrafts();
            this.loadCounts();
          },
          error: (e) => {
            this.importingId = null;
            this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo importar el borrador' });
            this.cdr.markForCheck();
          },
        });
      },
      error: (e) => {
        this.importingId = null;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo guardar la configuración antes de importar' });
        this.cdr.markForCheck();
      },
    });
  }

  statusSeverity(status: string): 'success' | 'warn' | 'secondary' {
    if (status === 'imported') return 'success';
    if (status === 'configured') return 'warn';
    return 'secondary';
  }

  // ── Importar con unidades (post-import, producto ya existe en Alegra) ──────────────

  private unitState = new Map<string, UnitImportState>();

  unitScannerVisible = false;
  unitScannerDraft: ProductImportDraft | null = null;
  unitScannerMode: 'scan' | 'imei' = 'scan';
  private unitScannerImeiTarget: { variantIdx: number; unitIdx: number } | null = null;

  unitStateFor(draft: ProductImportDraft): UnitImportState {
    let state = this.unitState.get(draft.id);
    if (!state) {
      state = {
        loading: true,
        submitting: false,
        sedeId: this.sedes.find((s) => s.store_key === draft.store_key)?.id ?? null,
        bodegaId: draft.alegra_product_cache?.warehouse_id ?? null,
        createdCount: null,
        variants: [],
        scanValue: '',
        creatingVariant: false,
        newVariantColorId: null,
        newVariantPreview: null,
        newVariantSku: '',
      };
      this.unitState.set(draft.id, state);
      if (draft.product_id) this.loadUnitState(draft, state);
    }
    return state;
  }

  private loadUnitState(draft: ProductImportDraft, state: UnitImportState): void {
    const productId = draft.product_id!;
    state.loading = true;
    forkJoin({
      variants: this.api.getVariantsByProduct(productId),
      count: this.api.getUnitCount(productId),
    }).subscribe({
      next: ({ variants, count }) => {
        state.variants = variants.map((v) => ({ variantId: v.id, color: v.color, sku: v.sku, pending: [] }));
        state.createdCount = count.created;
        state.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        state.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  hasPendingUnits(draft: ProductImportDraft): boolean {
    return this.unitStateFor(draft).variants.some((v) => v.pending.length > 0);
  }

  /** null si Alegra no reporta cantidad para este producto (nada que topear). */
  remainingUnits(draft: ProductImportDraft): number | null {
    const state = this.unitState.get(draft.id);
    const available = draft.alegra_product_cache?.available_quantity;
    if (available == null || !state || state.createdCount == null) return null;
    const pendingTotal = state.variants.reduce((sum, v) => sum + v.pending.length, 0);
    return available - state.createdCount - pendingTotal;
  }

  onUnitScanEnter(draft: ProductImportDraft, event: Event): void {
    event.preventDefault();
    const state = this.unitStateFor(draft);
    const code = state.scanValue.trim();
    state.scanValue = '';
    if (code) this.resolveUnitScan(draft, code);
  }

  openUnitScanScanner(draft: ProductImportDraft): void {
    this.unitScannerDraft = draft;
    this.unitScannerMode = 'scan';
    this.unitScannerImeiTarget = null;
    this.unitScannerVisible = true;
  }

  openUnitImeiScanner(draft: ProductImportDraft, variantIdx: number, unitIdx: number): void {
    this.unitScannerDraft = draft;
    this.unitScannerMode = 'imei';
    this.unitScannerImeiTarget = { variantIdx, unitIdx };
    this.unitScannerVisible = true;
  }

  onUnitBarcodeScanned(draft: ProductImportDraft, code: string): void {
    this.unitScannerVisible = false;
    if (this.unitScannerMode === 'imei' && this.unitScannerImeiTarget) {
      const state = this.unitStateFor(draft);
      const { variantIdx, unitIdx } = this.unitScannerImeiTarget;
      state.variants[variantIdx].pending[unitIdx].identifier = code;
      this.cdr.markForCheck();
      return;
    }
    this.resolveUnitScan(draft, code);
  }

  /**
   * Matchea el UPC escaneado/tipeado contra las variantes de color YA existentes de este producto
   * (mismo criterio que `matchAndAddProductBySku` en órdenes de compra: identifier exacto,
   * case-insensitive). Si matchea, agrega un slot de unidad vacío y salta el foco ahí. Si no
   * matchea, abre el panel inline para crear la variante con ese mismo UPC precargado.
   */
  private resolveUnitScan(draft: ProductImportDraft, code: string): void {
    const state = this.unitStateFor(draft);
    const remaining = this.remainingUnits(draft);
    if (remaining != null && remaining <= 0) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Sin cupo',
        detail: 'Ya se alcanzó la cantidad que reporta Alegra para este producto.',
      });
      return;
    }

    const variant = state.variants.find((v) => v.sku.trim().toLowerCase() === code.toLowerCase());
    if (variant) {
      variant.pending.push({ identifier: '' });
      const variantIdx = state.variants.indexOf(variant);
      this.focusUnitField(draft.id, variantIdx, variant.pending.length - 1);
    } else {
      state.creatingVariant = true;
      state.newVariantColorId = null;
      state.newVariantPreview = null;
      state.newVariantSku = code;
    }
    this.cdr.markForCheck();
  }

  private focusUnitField(draftId: string, variantIdx: number, unitIdx: number): void {
    // 300ms, not 0: PrimeNG's toast (shown alongside this focus jump when a variant was just
    // created) grabs focus onto its own close button ~150-200ms after appearing, which otherwise
    // wins the race and steals focus right back from the IMEI field.
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(
        `input[data-unit-key="${draftId}-${variantIdx}-${unitIdx}"]`,
      );
      el?.focus();
      el?.select();
    }, 300);
  }

  /** Enter en un campo de IMEI: salta al siguiente de ESTE draft (mismo patrón scan-Enter-scan de
   *  órdenes de compra); si era el último, vuelve al campo de escaneo de UPC. */
  onUnitImeiEnter(draft: ProductImportDraft, event: Event): void {
    event.preventDefault();
    const current = event.target as HTMLInputElement;
    const container = current.closest(`[data-unit-container="${draft.id}"]`);
    const fields = Array.from(container?.querySelectorAll<HTMLInputElement>('input[data-unit-key]') ?? []);
    const idx = fields.indexOf(current);
    const next = idx >= 0 ? fields[idx + 1] : undefined;
    if (next) {
      next.focus();
      next.select();
    } else {
      document.querySelector<HTMLInputElement>(`input[data-unit-scan="${draft.id}"]`)?.focus();
    }
  }

  removeUnitRow(draft: ProductImportDraft, variantIdx: number, unitIdx: number): void {
    const state = this.unitStateFor(draft);
    state.variants[variantIdx].pending.splice(unitIdx, 1);
    this.cdr.markForCheck();
  }

  onUnitVariantColorSelected(draft: ProductImportDraft, event: ColorSelectedEvent): void {
    const state = this.unitStateFor(draft);
    state.newVariantColorId = event.colorId;
    state.newVariantPreview = event.preview;
  }

  cancelCreateUnitVariant(draft: ProductImportDraft): void {
    this.unitStateFor(draft).creatingVariant = false;
  }

  saveNewUnitVariant(draft: ProductImportDraft): void {
    const state = this.unitStateFor(draft);
    const sku = state.newVariantSku.trim();
    if (!state.newVariantColorId || !sku) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Datos incompletos',
        detail: 'Elegí (o creá) un color y confirmá el UPC.',
      });
      return;
    }
    if (state.variants.some((v) => v.sku.trim().toLowerCase() === sku.toLowerCase())) {
      this.messageService.add({ severity: 'warn', summary: 'UPC repetido', detail: `Ya existe una variante con el UPC '${sku}'` });
      return;
    }
    if (!draft.product_id) return;

    state.submitting = true;
    this.api.createProductVariant(draft.product_id, { colorId: state.newVariantColorId, sku }).subscribe({
      next: (created) => {
        state.submitting = false;
        state.variants.push({ variantId: created.id, color: created.color, sku: created.sku, pending: [{ identifier: '' }] });
        const variantIdx = state.variants.length - 1;
        state.creatingVariant = false;
        this.messageService.add({
          severity: 'success',
          summary: 'Variante creada',
          detail: `${created.color?.name ?? 'Sin color'} — ${created.sku}`,
        });
        this.focusUnitField(draft.id, variantIdx, 0);
        this.cdr.markForCheck();
      },
      error: (e) => {
        state.submitting = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo crear la variante' });
        this.cdr.markForCheck();
      },
    });
  }

  submitUnits(draft: ProductImportDraft): void {
    const state = this.unitStateFor(draft);
    if (!draft.product_id || !state.sedeId) {
      this.messageService.add({ severity: 'warn', summary: 'Falta sede', detail: 'No se pudo resolver la sede de este borrador.' });
      return;
    }

    const toSubmit = state.variants
      .map((v) => ({ v, units: v.pending.filter((u) => u.identifier.trim()) }))
      .filter((x) => x.units.length > 0);
    if (!toSubmit.length) {
      this.messageService.add({ severity: 'warn', summary: 'Nada para guardar', detail: 'Escaneá o escribí al menos un IMEI/serial.' });
      return;
    }

    state.submitting = true;
    const productId = draft.product_id;
    const calls = toSubmit.map(({ v, units }) =>
      this.api.ingresoUnidades(
        productId,
        {
          sedeId: state.sedeId,
          bodegaId: state.bodegaId ?? undefined,
          productVariantId: v.variantId,
          unidades: units.map((u) => ({ identifier: u.identifier.trim() })),
        },
        false,
      ),
    );

    forkJoin(calls).subscribe({
      next: (results: any[]) => {
        state.submitting = false;
        const totalErrores = results.reduce((sum, r) => sum + (r?.resumen?.errores ?? 0), 0);
        const totalOk = results.reduce((sum, r) => sum + (r?.resumen?.variantesNuevas ?? 0), 0);
        if (totalErrores > 0) {
          this.messageService.add({
            severity: 'warn',
            summary: 'Guardado con errores',
            detail: `${totalOk} unidad(es) guardadas, ${totalErrores} con error (revisá duplicados).`,
          });
        } else {
          this.messageService.add({ severity: 'success', summary: 'Unidades guardadas', detail: `${totalOk} unidad(es) ingresada(s).` });
        }
        state.variants.forEach((v) => { v.pending = []; });
        this.loadUnitState(draft, state);
      },
      error: (e) => {
        state.submitting = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudieron guardar las unidades' });
        this.cdr.markForCheck();
      },
    });
  }
}
