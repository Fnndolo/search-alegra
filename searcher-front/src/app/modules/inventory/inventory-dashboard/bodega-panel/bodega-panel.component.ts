import { Component, Input, OnInit, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { InventoryApiService } from '../../services/inventory-api.service';
import { Sede, Bodega } from '../../models/inventory.models';

@Component({
  selector: 'app-bodega-panel',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ButtonModule, DialogModule,
    InputTextModule, InputNumberModule, ToggleSwitchModule, TagModule, ToastModule, TooltipModule
  ],
  providers: [MessageService],
  templateUrl: './bodega-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BodegaPanelComponent implements OnInit, OnChanges {
  @Input() sedes: Sede[] = [];
  private loadedSedeIds = new Set<string>();

  bodegasBySede: Record<string, Bodega[]> = {};
  loadingSede: Record<string, boolean> = {};
  showBodegaDialog = false;
  editingBodega: Bodega | null = null;
  selectedSedeId: string | null = null;
  bodegaForm = {
    nombre: '',
    esPrincipal: false,
    activo: true,
    prefix: '',
    alegraWarehouseId: null as number | null,
    alegraStoreKey: ''
  };
  loading = false;
  syncingBySede: Record<string, boolean> = {};

  constructor(
    private api: InventoryApiService,
    private messageService: MessageService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadPending();
  }

  ngOnChanges(changes: SimpleChanges) {
    // `sedes` arrives asynchronously from the parent (@Input), often after ngOnInit.
    // Without this, warehouses never load on a fresh page reload even though they exist in the DB.
    if (changes['sedes']) {
      this.loadPending();
    }
  }

  private loadPending() {
    for (const s of this.sedes) {
      if (!this.loadedSedeIds.has(s.id)) {
        this.loadedSedeIds.add(s.id);
        this.loadBodegas(s);
      }
    }
  }

  loadBodegas(sede: Sede) {
    this.loadingSede[sede.id] = true;
    this.api.getBodegasByStoreKey(sede.store_key).subscribe({
      next: (bodegas) => {
        this.bodegasBySede[sede.id] = bodegas;
        this.loadingSede[sede.id] = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.bodegasBySede[sede.id] = [];
        this.loadingSede[sede.id] = false;
        this.cdr.markForCheck();
      }
    });
  }

  syncFromAlegra(sede: Sede) {
    this.syncingBySede[sede.id] = true;
    this.api.syncWarehousesFromAlegra(sede.store_key).subscribe({
      next: () => {
        this.syncingBySede[sede.id] = false;
        this.messageService.add({ severity: 'success', summary: 'Bodegas sincronizadas desde Alegra' });
        this.loadBodegas(sede);
      },
      error: (e) => {
        this.syncingBySede[sede.id] = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo sincronizar' });
        this.cdr.markForCheck();
      }
    });
  }

  openCreateBodega(sede: Sede) {
    this.selectedSedeId = sede.id;
    this.editingBodega = null;
    this.bodegaForm = { nombre: '', esPrincipal: false, activo: true, prefix: '', alegraWarehouseId: null, alegraStoreKey: '' };
    this.showBodegaDialog = true;
  }

  openEditBodega(bodega: Bodega, sedeId: string) {
    this.selectedSedeId = sedeId;
    this.editingBodega = bodega;
    this.bodegaForm = {
      nombre: bodega.nombre,
      esPrincipal: bodega.es_principal,
      activo: bodega.activo,
      prefix: bodega.prefix ?? '',
      alegraWarehouseId: bodega.alegra_warehouse_id,
      alegraStoreKey: bodega.alegra_store_key ?? ''
    };
    this.showBodegaDialog = true;
  }

  saveBodega() {
    if (!this.bodegaForm.nombre.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Requerido', detail: 'El nombre es obligatorio' });
      return;
    }
    this.loading = true;

    const obs = this.editingBodega
      ? this.api.updateBodega(this.editingBodega.id, {
          nombre: this.bodegaForm.nombre.trim(),
          esPrincipal: this.bodegaForm.esPrincipal,
          activo: this.bodegaForm.activo,
          prefix: this.bodegaForm.esPrincipal ? null : (this.bodegaForm.prefix.trim() || null),
          alegraWarehouseId: this.bodegaForm.alegraWarehouseId ?? undefined,
          alegraStoreKey: this.bodegaForm.alegraStoreKey.trim() || undefined
        })
      : this.api.createBodega({
          sedeId: this.selectedSedeId!,
          nombre: this.bodegaForm.nombre.trim(),
          esPrincipal: this.bodegaForm.esPrincipal,
          prefix: this.bodegaForm.esPrincipal ? undefined : (this.bodegaForm.prefix.trim() || undefined),
          alegraWarehouseId: this.bodegaForm.alegraWarehouseId ?? undefined,
          alegraStoreKey: this.bodegaForm.alegraStoreKey.trim() || undefined
        });

    obs.subscribe({
      next: () => {
        this.loading = false;
        this.showBodegaDialog = false;
        this.messageService.add({ severity: 'success', summary: this.editingBodega ? 'Bodega actualizada' : 'Bodega creada' });
        const sede = this.sedes.find(s => s.id === this.selectedSedeId);
        if (sede) this.loadBodegas(sede);
      },
      error: (e) => {
        this.loading = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo guardar' });
      }
    });
  }
}
