import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { InventoryApiService } from '../../services/inventory-api.service';
import { Color } from '../../models/inventory.models';

@Component({
  selector: 'app-color-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, ToastModule],
  providers: [MessageService],
  templateUrl: './color-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorPanelComponent implements OnInit {
  colors: Color[] = [];
  loading = false;
  editingId: string | null = null;
  editForm: { name: string; hexCode: string } = { name: '', hexCode: '#cccccc' };
  saving = false;

  creating = false;
  showCreateForm = false;
  createForm: { name: string; hexCode: string } = { name: '', hexCode: '#cccccc' };

  constructor(private readonly api: InventoryApiService, private readonly messageService: MessageService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadColors();
  }

  loadColors(): void {
    this.loading = true;
    this.api.searchColors().subscribe({
      next: (colors) => {
        this.loading = false;
        this.colors = colors;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo cargar la paleta de colores' });
        this.cdr.markForCheck();
      },
    });
  }

  openCreateForm(): void {
    this.createForm = { name: '', hexCode: '#cccccc' };
    this.showCreateForm = true;
  }

  cancelCreate(): void {
    this.showCreateForm = false;
  }

  createColor(): void {
    if (!this.createForm.name.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Requerido', detail: 'El nombre es obligatorio' });
      return;
    }
    this.creating = true;
    this.api.createColor({ name: this.createForm.name.trim(), hexCode: this.createForm.hexCode }).subscribe({
      next: (created) => {
        this.creating = false;
        this.showCreateForm = false;
        this.colors = [...this.colors, created].sort((a, b) => a.name.localeCompare(b.name));
        this.messageService.add({ severity: 'success', summary: 'Color creado' });
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.creating = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo crear el color' });
        this.cdr.markForCheck();
      },
    });
  }

  startEdit(color: Color): void {
    this.editingId = color.id;
    this.editForm = { name: color.name, hexCode: color.hexCode ?? '#cccccc' };
  }

  cancelEdit(): void {
    this.editingId = null;
  }

  saveEdit(color: Color): void {
    if (!this.editForm.name.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Requerido', detail: 'El nombre es obligatorio' });
      return;
    }
    this.saving = true;
    this.api.updateColor(color.id, { name: this.editForm.name.trim(), hexCode: this.editForm.hexCode }).subscribe({
      next: (updated) => {
        this.saving = false;
        const idx = this.colors.findIndex((c) => c.id === color.id);
        if (idx !== -1) this.colors[idx] = updated;
        this.editingId = null;
        this.messageService.add({ severity: 'success', summary: 'Color actualizado' });
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.saving = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo guardar el color' });
        this.cdr.markForCheck();
      },
    });
  }
}
