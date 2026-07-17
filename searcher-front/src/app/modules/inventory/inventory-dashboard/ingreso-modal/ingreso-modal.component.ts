import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { TooltipModule } from 'primeng/tooltip';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { InventoryApiService } from '../../services/inventory-api.service';

export interface IngresoRow {
  identifier: string;
  precioVenta: number | null;
  precioCosto: number | null;
}

@Component({
  selector: 'app-ingreso-modal',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ButtonModule, DialogModule,
    DropdownModule, TooltipModule, TagModule, ToastModule
  ],
  providers: [MessageService],
  templateUrl: './ingreso-modal.component.html'
})
export class IngresoModalComponent implements OnChanges {
  @Input() visible = false;
  @Input() producto: any = null;
  @Input() sedes: any[] = [];
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() saved = new EventEmitter<void>();

  selectedSedeId: string | null = null;
  selectedBodegaId: string | null = null;
  bodegas: any[] = [];

  rows: IngresoRow[] = [];
  preview: any = null;
  loadingPreview = false;
  loadingSave = false;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['visible']?.currentValue === true) {
      this.reset();
    }
  }

  constructor(private api: InventoryApiService, private messageService: MessageService) {}

  reset() {
    this.selectedSedeId = null;
    this.selectedBodegaId = null;
    this.bodegas = [];
    this.rows = [this.emptyRow()];
    this.preview = null;
  }

  emptyRow(): IngresoRow {
    return { identifier: '', precioVenta: null, precioCosto: null };
  }

  addRow() {
    this.rows.push(this.emptyRow());
    this.preview = null;
  }

  removeRow(i: number) {
    this.rows.splice(i, 1);
    this.preview = null;
    if (this.rows.length === 0) this.rows.push(this.emptyRow());
  }

  onSedeChange() {
    this.selectedBodegaId = null;
    this.bodegas = [];
    this.preview = null;
    if (!this.selectedSedeId) return;
    const sede = this.sedes.find(s => s.id === this.selectedSedeId);
    if (sede?.bodegas) {
      this.bodegas = sede.bodegas;
    }
  }

  close() {
    this.visible = false;
    this.visibleChange.emit(false);
  }

  buildDto() {
    return {
      sedeId: this.selectedSedeId,
      bodegaId: this.selectedBodegaId || undefined,
      unidades: this.rows
        .filter(r => r.identifier.trim())
        .map(r => ({
          identifier: r.identifier.trim(),
          precioVenta: r.precioVenta ?? undefined,
          precioCosto: r.precioCosto ?? undefined,
        }))
    };
  }

  previsualize() {
    if (!this.selectedSedeId || !this.producto) return;
    this.loadingPreview = true;
    this.preview = null;
    this.api.ingresoUnidades(this.producto.id, this.buildDto(), true).subscribe({
      next: (res) => {
        this.loadingPreview = false;
        this.preview = res;
      },
      error: (e) => {
        this.loadingPreview = false;
        this.messageService.add({ severity: 'error', summary: 'Error en preview', detail: e?.error?.message || 'No se pudo previsualizar' });
      }
    });
  }

  confirm() {
    if (!this.selectedSedeId || !this.producto) return;
    this.loadingSave = true;
    this.api.ingresoUnidades(this.producto.id, this.buildDto(), false).subscribe({
      next: (res) => {
        this.loadingSave = false;
        const total = (res as any)?.resumen?.totalUnidades ?? 0;
        this.messageService.add({ severity: 'success', summary: 'Ingreso completado', detail: `${total} unidad(es) ingresada(s)` });
        setTimeout(() => {
          this.saved.emit();
          this.close();
        }, 1200);
      },
      error: (e) => {
        this.loadingSave = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo completar el ingreso' });
      }
    });
  }

  get canAction(): boolean {
    return !!this.selectedSedeId && this.rows.some(r => r.identifier.trim());
  }

  formatCurrency(v: number | null): string {
    if (v == null) return '—';
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
  }
}
