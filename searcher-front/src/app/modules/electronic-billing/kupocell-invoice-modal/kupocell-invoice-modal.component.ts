import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { CheckboxModule } from 'primeng/checkbox';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { ProgressBarModule } from 'primeng/progressbar';
import { ElectronicBillingService, BillingInvoice } from '../services/electronic-billing.service';

@Component({
  selector: 'app-kupocell-invoice-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    DropdownModule,
    CheckboxModule,
    ButtonModule,
    TagModule,
    DividerModule,
    ProgressBarModule,
  ],
  template: `
    <p-dialog [(visible)]="visible" [modal]="true" [draggable]="false" [resizable]="false"
      [style]="{ width: '100%', maxWidth: '600px' }" [closable]="!processing" styleClass="kupocell-modal m-4"
      (onHide)="onClose()">

      <ng-template pTemplate="header">
        <div class="flex items-center gap-3 w-full">
          <div class="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
            <i class="pi pi-send text-green-600 text-lg"></i>
          </div>
          <div>
            <span class="font-bold text-lg text-surface-900">Facturar en Kupocell</span>
            <p class="text-sm text-surface-500 mt-0.5">{{ invoices.length }} factura(s) seleccionada(s)</p>
          </div>
        </div>
      </ng-template>

      <!-- STEP 1: Configuration -->
      <div *ngIf="step === 'config'" class="config-step">

        <!-- Summary -->
        <div class="bg-green-50 rounded-xl p-4 mb-5 border border-green-200">
          <div class="flex items-center gap-3 mb-2">
            <i class="pi pi-info-circle text-green-600"></i>
            <span class="text-sm font-medium text-green-800">Resumen de facturación</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div class="text-center bg-white/50 rounded-lg p-2">
              <div class="text-2xl font-bold text-green-700">{{ invoices.length }}</div>
              <div class="text-xs text-green-600">Facturas</div>
            </div>
            <div class="text-center bg-white/50 rounded-lg p-2">
              <div class="text-2xl font-bold text-green-700">{{ totalItems }}</div>
              <div class="text-xs text-green-600">Productos</div>
            </div>
            <div class="text-center bg-white/50 rounded-lg p-2">
              <div class="text-lg font-bold text-green-700">{{ totalAmount | currency:'COP':'symbol':'1.0-0' }}</div>
              <div class="text-xs text-green-600">Total</div>
            </div>
          </div>
        </div>

        <!-- Warehouse -->
        <div class="mb-4">
          <label class="block text-sm font-semibold text-surface-700 mb-1.5">
            <i class="pi pi-building mr-1 text-surface-400"></i> Bodega
          </label>
          <p-dropdown [options]="warehouseOptions" [(ngModel)]="selectedWarehouseId"
            placeholder="Seleccione una bodega" styleClass="w-full" optionLabel="label" optionValue="value">
          </p-dropdown>
        </div>

        <!-- Cost Center -->
        <div class="mb-4">
          <label class="block text-sm font-semibold text-surface-700 mb-1.5">
            <i class="pi pi-sitemap mr-1 text-surface-400"></i> Centro de Costo
          </label>
          <p-dropdown [options]="costCenterOptions" [(ngModel)]="selectedCostCenterId"
            placeholder="Seleccione un centro de costo" styleClass="w-full" optionLabel="label" optionValue="value">
          </p-dropdown>
        </div>

        <!-- IVA Toggle -->
        <div class="bg-surface-50 rounded-xl p-4 border border-surface-200">
          <div class="flex items-center gap-3">
            <p-checkbox [(ngModel)]="applyIva" [binary]="true" inputId="ivaToggle"></p-checkbox>
            <label for="ivaToggle" class="cursor-pointer">
              <span class="text-sm font-semibold text-surface-700">Aplicar IVA 19%</span>
              <p class="text-xs text-surface-500 mt-0.5">Se aplicará el impuesto sobre el valor agregado a todos los productos</p>
            </label>
          </div>
        </div>

        <!-- Loading config -->
        <div *ngIf="loadingConfig" class="text-center py-4 text-surface-500 text-sm">
          <i class="pi pi-spin pi-spinner mr-1"></i> Cargando configuración...
        </div>

      </div>

      <!-- STEP 2: Processing -->
      <div *ngIf="step === 'processing'" class="processing-step text-center py-6">
        <i class="pi pi-spin pi-spinner text-4xl text-primary-500 mb-4 block"></i>
        <h3 class="text-lg font-bold text-surface-800 mb-2">Procesando facturas...</h3>
        <p class="text-sm text-surface-500 mb-4">
          Factura {{ currentIndex + 1 }} de {{ invoices.length }}
        </p>
        <p-progressBar [value]="progressPercent" [style]="{ height: '8px' }" styleClass="rounded-full"></p-progressBar>
        <p class="text-xs text-surface-400 mt-3">
          {{ currentStatus }}
        </p>
      </div>

      <!-- STEP 3: Results -->
      <div *ngIf="step === 'results'" class="results-step">
        <div class="text-center mb-5">
          <i class="pi text-5xl mb-3 block"
            [class.pi-check-circle]="failCount === 0"
            [class.text-green-500]="failCount === 0"
            [class.pi-exclamation-triangle]="failCount > 0"
            [class.text-amber-500]="failCount > 0">
          </i>
          <h3 class="text-lg font-bold text-surface-800">
            {{ failCount === 0 ? '¡Facturación completada!' : 'Facturación con errores' }}
          </h3>
          <p class="text-sm text-surface-500 mt-1">
            {{ successCount }} de {{ results.length }} facturas creadas exitosamente
          </p>
        </div>

        <div class="space-y-2 max-h-60 overflow-y-auto">
          <div *ngFor="let r of results" class="flex items-center gap-3 p-3 rounded-lg border"
            [class.bg-green-50]="r.success" [class.border-green-200]="r.success"
            [class.bg-red-50]="!r.success" [class.border-red-200]="!r.success">
            <i class="pi" 
              [class.pi-check-circle]="r.success" [class.text-green-500]="r.success"
              [class.pi-times-circle]="!r.success" [class.text-red-500]="!r.success">
            </i>
            <div class="flex-1 text-sm">
              <span class="font-medium">Factura #{{ r.invoiceId }}</span>
              <span *ngIf="r.kupocellNumber" class="text-green-600 ml-2">→ Kupocell #{{ r.kupocellNumber }}</span>
              <p *ngIf="r.error" class="text-xs text-red-500 mt-0.5">{{ r.error }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <ng-template pTemplate="footer">
        <div class="flex justify-between w-full">
          <button *ngIf="step !== 'processing'" pButton label="Cerrar" icon="pi pi-times"
            class="p-button-text p-button-secondary" (click)="onClose()"></button>
          <div *ngIf="step === 'processing'"></div>

          <button *ngIf="step === 'config'" pButton label="Facturar" icon="pi pi-send"
            class="p-button-success shadow-sm"
            (click)="startProcessing()"
            [disabled]="!selectedWarehouseId || !selectedCostCenterId || loadingConfig">
          </button>

          <!-- Éxito total: botón Finalizar verde que recarga datos -->
          <button *ngIf="step === 'results' && failCount === 0" pButton label="Finalizar" icon="pi pi-check"
            class="p-button-success shadow-sm" (click)="finish()">
          </button>

          <!-- Con errores: botón Cerrar rojo/outlined, no recarga -->
          <button *ngIf="step === 'results' && failCount > 0" pButton label="Cerrar" icon="pi pi-times"
            class="p-button-outlined p-button-danger shadow-sm" (click)="onClose()">
          </button>
        </div>
      </ng-template>

    </p-dialog>
  `,
  styles: [`
    :host ::ng-deep .kupocell-modal .p-dialog-header {
      border-bottom: 1px solid #e2e8f0;
    }
    :host ::ng-deep .kupocell-modal .p-dialog-footer {
      border-top: 1px solid #e2e8f0;
    }
    .space-y-2 > * + * { margin-top: 0.5rem; }
  `]
})
export class KupocellInvoiceModalComponent implements OnChanges {
  @Input() visible = false;
  @Input() invoices: BillingInvoice[] = [];
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() onComplete = new EventEmitter<void>();

  step: 'config' | 'processing' | 'results' = 'config';
  loadingConfig = false;
  processing = false;

  // Config options
  warehouseOptions: { label: string, value: string }[] = [];
  costCenterOptions: { label: string, value: string }[] = [];
  storeMappings: Record<string, { warehouseId: string, costCenterId: string }> = {};

  // Selected config
  selectedWarehouseId = '';
  selectedCostCenterId = '';
  applyIva = false;

  // Processing state
  currentIndex = 0;
  currentStatus = '';
  results: { invoiceId: number, success: boolean, kupocellNumber?: string, error?: string }[] = [];

  constructor(private billingService: ElectronicBillingService) { }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['visible'] && this.visible) {
      this.step = 'config';
      this.results = [];
      this.currentIndex = 0;
      this.loadConfig();
    }
  }

  get totalItems(): number {
    return this.invoices.reduce((sum, inv) => sum + (inv.selectedItemsCount || inv.itemsCount), 0);
  }

  get totalAmount(): number {
    return this.invoices.reduce((sum, inv) => sum + inv.total, 0);
  }

  get progressPercent(): number {
    if (this.invoices.length === 0) return 0;
    return Math.round(((this.currentIndex + 1) / this.invoices.length) * 100);
  }

  get successCount(): number {
    return this.results.filter(r => r.success).length;
  }

  get failCount(): number {
    return this.results.filter(r => !r.success).length;
  }

  loadConfig() {
    this.loadingConfig = true;
    this.billingService.getKupocellConfig().subscribe({
      next: (config) => {
        this.warehouseOptions = config.warehouses.map(w => ({ label: w.name, value: w.id }));
        this.costCenterOptions = config.costCenters.map(cc => ({ label: cc.name, value: cc.id }));
        this.storeMappings = config.storeMappings;

        // Auto-select based on store of first invoice
        if (this.invoices.length > 0) {
          const store = this.invoices[0].store?.toLowerCase();
          const mapping = this.storeMappings[store];
          if (mapping) {
            this.selectedWarehouseId = mapping.warehouseId;
            this.selectedCostCenterId = mapping.costCenterId;
          }
        }

        this.loadingConfig = false;
      },
      error: () => {
        this.loadingConfig = false;
      }
    });
  }

  startProcessing() {
    this.step = 'processing';
    this.processing = true;
    this.currentIndex = 0;
    this.currentStatus = 'Iniciando...';
    this.results = [];

    const invoiceIds = this.invoices.map(inv => ({ id: inv.id, store: inv.store }));

    this.currentStatus = 'Enviando facturas a Kupocell...';

    this.billingService.createKupocellInvoice({
      invoiceIds,
      warehouseId: this.selectedWarehouseId,
      costCenterId: this.selectedCostCenterId,
      applyIva: this.applyIva,
    }).subscribe({
      next: (response) => {
        this.results = response.results;
        this.currentIndex = this.invoices.length - 1;
        this.processing = false;
        this.step = 'results';
      },
      error: (err) => {
        this.results = this.invoices.map(inv => ({
          invoiceId: inv.id,
          success: false,
          error: 'Error de conexión con el servidor'
        }));
        this.processing = false;
        this.step = 'results';
      }
    });
  }

  finish() {
    this.onComplete.emit();
    this.onClose();
  }

  onClose() {
    if (this.processing) return;
    this.visible = false;
    this.visibleChange.emit(false);
  }
}
