import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DropdownModule } from 'primeng/dropdown';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { InventoryApiService } from '../../services/inventory-api.service';
import { ColorPickerComponent, ColorSelectedEvent } from '../color-picker/color-picker.component';
import { Color } from '../../models/inventory.models';

interface VariantRow {
  color?: string;
  colorId?: string;
  preview: Color | null;
  sku: string;
}

@Component({
  selector: 'app-product-form-modal',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ButtonModule, DialogModule,
    InputTextModule, InputNumberModule, DropdownModule, TextareaModule,
    ToggleSwitchModule, ToastModule, ColorPickerComponent
  ],
  providers: [MessageService],
  templateUrl: './product-form-modal.component.html'
})
export class ProductFormModalComponent implements OnInit {
  @Input() visible = false;
  @Input() storeId: string | null = null;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() saved = new EventEmitter<void>();

  form: any = {
    name: '',
    categoryId: null,
    hasIdentifier: true,
    salePrice: null,
    negativeSell: false,
  };

  variants: VariantRow[] = [{ preview: null, sku: '' }];

  categorias: any[] = [];
  loading = false;

  constructor(
    private api: InventoryApiService,
    private messageService: MessageService
  ) {}

  ngOnInit() {
    this.api.getCategorias().subscribe({
      next: d => this.categorias = d,
      error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar las categorías' })
    });
  }

  close() {
    this.visible = false;
    this.visibleChange.emit(false);
    this.resetForm();
  }

  resetForm() {
    this.form = {
      name: '',
      categoryId: null,
      hasIdentifier: true,
      salePrice: null,
      negativeSell: false,
    };
    this.variants = [{ preview: null, sku: '' }];
  }

  addVariantRow() {
    this.variants.push({ preview: null, sku: '' });
  }

  removeVariantRow(index: number) {
    if (this.variants.length <= 1) return;
    this.variants.splice(index, 1);
  }

  onVariantColorSelected(index: number, event: ColorSelectedEvent) {
    this.variants[index].color = event.color;
    this.variants[index].colorId = event.colorId;
    this.variants[index].preview = event.preview;
  }

  private validateVariants(): string | null {
    if (!this.variants.length) {
      return 'Agregá al menos una variante';
    }
    const skus = new Set<string>();
    for (const variant of this.variants) {
      if ((!variant.color?.trim() && !variant.colorId) || !variant.sku?.trim()) {
        return 'Todas las variantes deben tener color y SKU';
      }
      const sku = variant.sku.trim();
      if (skus.has(sku)) {
        return `El SKU '${sku}' está repetido`;
      }
      skus.add(sku);
    }
    return null;
  }

  save() {
    if (!this.storeId) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Sede requerida',
        detail: 'Seleccioná una sede antes de crear productos',
      });
      return;
    }

    if (!this.form.name?.trim() || !this.form.categoryId) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Campos requeridos',
        detail: 'Completá nombre y categoría',
      });
      return;
    }

    const variantsError = this.validateVariants();
    if (variantsError) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Variantes inválidas',
        detail: variantsError,
      });
      return;
    }

    this.loading = true;
    this.api.createProducto({
      name: this.form.name.trim(),
      categoryId: this.form.categoryId,
      storeId: this.storeId,
      hasIdentifier: this.form.hasIdentifier,
      negativeSell: this.form.negativeSell,
      salePrice: this.form.salePrice ?? undefined,
      variants: this.variants.map(v => ({
        ...(v.colorId ? { colorId: v.colorId } : { color: v.color!.trim() }),
        sku: v.sku.trim(),
      })),
    }).subscribe({
      next: () => {
        this.loading = false;
        this.messageService.add({ severity: 'success', summary: 'Producto creado', detail: this.form.name });
        this.saved.emit();
        this.close();
      },
      error: (e) => {
        this.loading = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo crear el producto' });
      }
    });
  }
}
