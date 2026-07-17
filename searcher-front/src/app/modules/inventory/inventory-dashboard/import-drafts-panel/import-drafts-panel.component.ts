import { Component, Input, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { PaginatorModule } from 'primeng/paginator';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { MessageService } from 'primeng/api';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { InventoryApiService } from '../../services/inventory-api.service';
import { Categoria, Color, ImportDraftStatus, ProductImportDraft, Sede } from '../../models/inventory.models';
import { ColorPickerComponent, ColorSelectedEvent } from '../color-picker/color-picker.component';

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

@Component({
  selector: 'app-import-drafts-panel',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ButtonModule, DropdownModule,
    InputTextModule, InputNumberModule, ToggleSwitchModule, TagModule, ToastModule,
    PaginatorModule, IconFieldModule, InputIconModule,
    ColorPickerComponent,
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
    // Drafts only store a free-text color name (find-or-create happens at import time),
    // so both branches resolve to the display name.
    row.color = event.color ?? event.preview?.name ?? '';
    row.colorId = event.colorId;
    row.preview = event.preview ?? (row.color ? { id: '', name: row.color, hexCode: null } : null);
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

  saveDraft(draft: ProductImportDraft): void {
    const state = this.editFor(draft);
    if (!state.categoryId) {
      this.messageService.add({ severity: 'warn', summary: 'Datos incompletos', detail: 'La categoría es obligatoria.' });
      return;
    }
    const variantsError = this.validateVariants(state);
    if (variantsError) {
      this.messageService.add({ severity: 'warn', summary: 'Variantes inválidas', detail: variantsError });
      return;
    }
    this.saving[draft.id] = true;
    this.api.updateImportDraft(draft.id, {
      categoryId: state.categoryId,
      variants: state.variants.map((v) => ({ color: v.color!.trim(), sku: v.sku.trim() })),
      salePrice: state.salePrice ?? undefined,
      hasIdentifier: state.hasIdentifier,
      negativeSell: state.negativeSell,
    }).subscribe({
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

  importDraft(draft: ProductImportDraft): void {
    this.importingId = draft.id;
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
  }

  statusSeverity(status: string): 'success' | 'warn' | 'secondary' {
    if (status === 'imported') return 'success';
    if (status === 'configured') return 'warn';
    return 'secondary';
  }
}
