import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { InventoryApiService } from '../../services/inventory-api.service';

interface Categoria {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
}

@Component({
  selector: 'app-catalogo-panel',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ButtonModule, DialogModule,
    InputTextModule, ToggleSwitchModule, TagModule, ToastModule
  ],
  providers: [MessageService],
  templateUrl: './catalogo-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CatalogoPanelComponent {
  @Input() categorias: Categoria[] = [];
  @Output() changed = new EventEmitter<void>();

  showCategoriaDialog = false;
  editingCategoria: Categoria | null = null;
  categoriaForm = { name: '', description: '', active: true };
  loading = false;

  showDeleteDialog = false;
  deletingCategoria: Categoria | null = null;
  deleting = false;

  constructor(private api: InventoryApiService, private messageService: MessageService) {}

  openCreateCategoria() {
    this.editingCategoria = null;
    this.categoriaForm = { name: '', description: '', active: true };
    this.showCategoriaDialog = true;
  }

  openEditCategoria(c: Categoria) {
    this.editingCategoria = c;
    this.categoriaForm = {
      name: c.name,
      description: c.description ?? '',
      active: c.active,
    };
    this.showCategoriaDialog = true;
  }

  confirmDelete(c: Categoria) {
    this.deletingCategoria = c;
    this.showDeleteDialog = true;
  }

  deleteCategoria() {
    if (!this.deletingCategoria) return;
    this.deleting = true;
    this.api.deleteCategoria(this.deletingCategoria.id).subscribe({
      next: () => {
        this.deleting = false;
        this.showDeleteDialog = false;
        this.deletingCategoria = null;
        this.messageService.add({ severity: 'success', summary: 'Categoría eliminada' });
        this.changed.emit();
      },
      error: (e) => {
        this.deleting = false;
        this.messageService.add({
          severity: 'error',
          summary: 'No se pudo eliminar',
          detail: e?.error?.message || 'La categoría no se pudo eliminar',
          life: 6000,
        });
      },
    });
  }

  saveCategoria() {
    if (!this.categoriaForm.name.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Requerido', detail: 'El nombre es obligatorio' });
      return;
    }
    this.loading = true;
    const obs = this.editingCategoria
      ? this.api.updateCategoria(this.editingCategoria.id, {
          nombre: this.categoriaForm.name.trim(),
          descripcion: this.categoriaForm.description.trim() || undefined,
          activo: this.categoriaForm.active,
        })
      : this.api.createCategoria({
          nombre: this.categoriaForm.name.trim(),
          descripcion: this.categoriaForm.description.trim() || undefined,
        });

    obs.subscribe({
      next: () => {
        this.loading = false;
        this.showCategoriaDialog = false;
        this.messageService.add({
          severity: 'success',
          summary: this.editingCategoria ? 'Categoría actualizada' : 'Categoría creada',
        });
        this.changed.emit();
      },
      error: (e) => {
        this.loading = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo guardar' });
      },
    });
  }
}
