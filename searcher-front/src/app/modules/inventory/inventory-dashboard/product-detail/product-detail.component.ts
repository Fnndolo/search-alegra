import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DropdownModule } from 'primeng/dropdown';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageService } from 'primeng/api';

import { InventoryApiService, AlegraStatusRow } from '../../services/inventory-api.service';
import { ColorPickerComponent, ColorSelectedEvent } from '../color-picker/color-picker.component';
import { Categoria, Color, ProductoDetalle, VarianteDetalle } from '../../models/inventory.models';

interface ProductEditForm {
  name: string;
  categoryId: string | null;
  active: boolean;
  hasIdentifier: boolean;
  negativeSell: boolean;
  salePrice: number | null;
}

interface VariantEditForm {
  sku: string;
  active: boolean;
  color?: string;
  colorId?: string;
  preview: Color | null;
}

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ButtonModule, CardModule, TagModule,
    DialogModule, InputTextModule, InputNumberModule, DropdownModule,
    ToggleSwitchModule, TableModule, ToastModule, ProgressSpinnerModule,
    ColorPickerComponent,
  ],
  providers: [MessageService],
  templateUrl: './product-detail.component.html',
  styleUrl: './product-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductDetailComponent implements OnInit {
  productId!: string;
  producto: ProductoDetalle | null = null;
  loading = true;

  categorias: Categoria[] = [];
  expandedRows: { [key: string]: boolean } = {};

  // ── Edit product ──────────────────────────────────────
  showEditProduct = false;
  savingProduct = false;
  productForm: ProductEditForm = {
    name: '', categoryId: null, active: true, hasIdentifier: true, negativeSell: false, salePrice: null,
  };

  // ── Delete product ────────────────────────────────────
  showDeleteProduct = false;
  deletingProduct = false;

  // ── Edit variant ──────────────────────────────────────
  showEditVariant = false;
  savingVariant = false;
  editingVariant: VarianteDetalle | null = null;
  variantForm: VariantEditForm = { sku: '', active: true, preview: null };

  // ── Delete variant ────────────────────────────────────
  showDeleteVariant = false;
  deletingVariant = false;
  variantToDelete: VarianteDetalle | null = null;

  // ── Alegra publish status per bodega ──────────────────
  alegraStatus: AlegraStatusRow[] = [];
  loadingAlegraStatus = false;
  publishing: Record<string, boolean> = {};

  constructor(
    private readonly api: InventoryApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly messageService: MessageService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.productId = this.route.snapshot.paramMap.get('id') as string;
    this.loadCategorias();
    this.loadDetail();
  }

  loadCategorias(): void {
    this.api.getCategorias().subscribe({
      next: (data) => { this.categorias = data; this.cdr.markForCheck(); },
      error: () => {},
    });
  }

  loadDetail(): void {
    this.loading = true;
    this.api.getProductDetail(this.productId).subscribe({
      next: (data) => {
        this.producto = data;
        this.loading = false;
        this.cdr.markForCheck();
        this.loadAlegraStatus();
      },
      error: () => {
        this.loading = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo cargar el producto' });
        this.cdr.markForCheck();
      },
    });
  }

  // ── Alegra publish status per bodega ──────────────────
  loadAlegraStatus(): void {
    this.loadingAlegraStatus = true;
    this.api.getAlegraStatus(this.productId).subscribe({
      next: (rows) => {
        this.alegraStatus = rows;
        this.loadingAlegraStatus = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingAlegraStatus = false;
        this.cdr.markForCheck();
      },
    });
  }

  publishInWarehouse(row: AlegraStatusRow): void {
    this.publishing[row.warehouseId] = true;
    this.api.createInWarehouse(this.productId, row.warehouseId).subscribe({
      next: (result) => {
        this.publishing[row.warehouseId] = false;
        const idx = this.alegraStatus.findIndex((r) => r.warehouseId === row.warehouseId);
        if (idx !== -1) {
          this.alegraStatus[idx] = {
            ...row,
            created: true,
            alegraItemId: result.alegraItemId ?? null,
            alegraName: result.alegraName ?? null,
          };
        }
        this.messageService.add({ severity: 'success', summary: 'Item creado en Alegra', detail: result.alegraName });
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.publishing[row.warehouseId] = false;
        this.messageService.add({
          severity: 'error', summary: 'No se pudo publicar',
          detail: e?.error?.message || 'No se pudo crear el item en Alegra para esta bodega', life: 8000,
        });
        this.cdr.markForCheck();
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/inventario/productos']);
  }

  toggleRow(variant: VarianteDetalle): void {
    if (this.expandedRows[variant.id]) {
      delete this.expandedRows[variant.id];
    } else {
      this.expandedRows[variant.id] = true;
    }
    this.expandedRows = { ...this.expandedRows };
  }

  unitStatusLabel(unit: { exitDate: string | null; active: boolean }): string {
    if (unit.exitDate) return 'Vendido / de baja';
    return unit.active ? 'En stock' : 'Inactivo';
  }

  unitStatusSeverity(unit: { exitDate: string | null; active: boolean }): 'success' | 'secondary' | 'danger' {
    if (unit.exitDate) return 'secondary';
    return unit.active ? 'success' : 'danger';
  }

  swatchStyle(color: Color | null): Record<string, string> {
    return { background: color?.hexCode || '#d1d5db' };
  }

  // ── Edit product ──────────────────────────────────────
  openEditProduct(): void {
    if (!this.producto) return;
    this.productForm = {
      name: this.producto.name,
      categoryId: this.producto.category?.id ?? null,
      active: this.producto.active,
      hasIdentifier: this.producto.hasIdentifier,
      negativeSell: this.producto.negativeSell,
      salePrice: this.producto.salePrice ?? null,
    };
    this.showEditProduct = true;
  }

  saveProduct(): void {
    if (!this.producto) return;
    if (!this.productForm.name?.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Requerido', detail: 'El nombre es obligatorio' });
      return;
    }
    this.savingProduct = true;
    this.api.updateProducto(this.producto.id, {
      name: this.productForm.name.trim(),
      categoryId: this.productForm.categoryId ?? undefined,
      active: this.productForm.active,
      hasIdentifier: this.productForm.hasIdentifier,
      negativeSell: this.productForm.negativeSell,
      salePrice: this.productForm.salePrice,
    }).subscribe({
      next: () => {
        this.savingProduct = false;
        this.showEditProduct = false;
        this.messageService.add({ severity: 'success', summary: 'Producto actualizado' });
        this.loadDetail();
      },
      error: (e) => {
        this.savingProduct = false;
        this.messageService.add({
          severity: 'error', summary: 'No se pudo actualizar',
          detail: e?.error?.message || 'Ocurrió un error al actualizar el producto', life: 6000,
        });
      },
    });
  }

  // ── Delete product ────────────────────────────────────
  confirmDeleteProduct(): void {
    this.showDeleteProduct = true;
  }

  deleteProduct(): void {
    if (!this.producto) return;
    this.deletingProduct = true;
    this.api.deleteProducto(this.producto.id).subscribe({
      next: () => {
        this.deletingProduct = false;
        this.showDeleteProduct = false;
        this.messageService.add({ severity: 'success', summary: 'Producto eliminado' });
        this.router.navigate(['/inventario/productos']);
      },
      error: (e) => {
        this.deletingProduct = false;
        this.messageService.add({
          severity: 'error', summary: 'No se pudo eliminar',
          detail: e?.error?.message || 'El producto no se pudo eliminar', life: 8000,
        });
      },
    });
  }

  // ── Add / edit variant ──────────────────────────────────
  /** `editingVariant = null` means the dialog is in "create new" mode instead of "edit". */
  openAddVariant(): void {
    this.editingVariant = null;
    this.variantForm = { sku: '', active: true, preview: null };
    this.showEditVariant = true;
  }

  openEditVariant(variant: VarianteDetalle): void {
    this.editingVariant = variant;
    this.variantForm = {
      sku: variant.sku,
      active: variant.active,
      preview: variant.color,
    };
    this.showEditVariant = true;
  }

  onVariantColorSelected(event: ColorSelectedEvent): void {
    this.variantForm.color = event.color;
    this.variantForm.colorId = event.colorId;
    this.variantForm.preview = event.preview;
  }

  saveVariant(): void {
    if (!this.producto) return;
    if (!this.variantForm.sku?.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Requerido', detail: 'El SKU es obligatorio' });
      return;
    }
    if (!this.editingVariant && !this.variantForm.colorId && !this.variantForm.color?.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Requerido', detail: 'El color es obligatorio' });
      return;
    }

    this.savingVariant = true;
    const body: { sku?: string; active?: boolean; color?: string; colorId?: string } = {
      sku: this.variantForm.sku.trim(),
      active: this.variantForm.active,
    };
    if (this.variantForm.colorId) body.colorId = this.variantForm.colorId;
    else if (this.variantForm.color) body.color = this.variantForm.color;

    const isEdit = !!this.editingVariant;
    const request$ = this.editingVariant
      ? this.api.updateProductVariant(this.editingVariant.id, body)
      : this.api.createProductVariant(this.producto.id, body as { sku: string; color?: string; colorId?: string });

    request$.subscribe({
      next: () => {
        this.savingVariant = false;
        this.showEditVariant = false;
        this.editingVariant = null;
        this.messageService.add({
          severity: 'success',
          summary: isEdit ? 'Variante actualizada' : 'Variante agregada',
        });
        this.loadDetail();
      },
      error: (e) => {
        this.savingVariant = false;
        this.messageService.add({
          severity: 'error', summary: 'No se pudo guardar',
          detail: e?.error?.message || 'Ocurrió un error al guardar la variante', life: 6000,
        });
      },
    });
  }

  // ── Delete variant ────────────────────────────────────
  confirmDeleteVariant(variant: VarianteDetalle): void {
    this.variantToDelete = variant;
    this.showDeleteVariant = true;
  }

  deleteVariant(): void {
    if (!this.variantToDelete) return;
    this.deletingVariant = true;
    this.api.deleteProductVariant(this.variantToDelete.id).subscribe({
      next: () => {
        this.deletingVariant = false;
        this.showDeleteVariant = false;
        this.variantToDelete = null;
        this.messageService.add({ severity: 'success', summary: 'Variante eliminada' });
        this.loadDetail();
      },
      error: (e) => {
        this.deletingVariant = false;
        this.messageService.add({
          severity: 'error', summary: 'No se pudo eliminar',
          detail: e?.error?.message || 'La variante no se pudo eliminar', life: 8000,
        });
      },
    });
  }
}
