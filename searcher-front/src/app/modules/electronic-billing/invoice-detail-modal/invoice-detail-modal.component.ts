import { Component, Input, Output, EventEmitter, SimpleChanges, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { CheckboxModule } from 'primeng/checkbox';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { TooltipModule } from 'primeng/tooltip';
import { BillingInvoice, InvoiceItem, ElectronicBillingService } from '../services/electronic-billing.service';

const CASH_KEYWORDS = ['efectivo', 'cash', 'caja', 'terminal', 'caja menor', 'caja general', 'datafono', 'datáfono'];

@Component({
  selector: 'app-invoice-detail-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    CheckboxModule,
    ButtonModule,
    TagModule,
    DividerModule,
    TooltipModule
  ],
  template: `
    <p-dialog [(visible)]="visible" [modal]="true" [draggable]="false" [resizable]="false"
      [style]="{ width: '100%', maxWidth: '720px', maxHeight: '90vh' }" [closable]="true"
      styleClass="invoice-detail-dialog m-4" (onHide)="onClose()">

      <!-- Header -->
      <ng-template pTemplate="header">
        <div class="flex items-center gap-3 w-full">
          <div class="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
            <i class="pi pi-file-edit text-primary-600 text-lg"></i>
          </div>
          <div>
            <span class="font-bold text-lg text-surface-900">Factura #{{ invoice?.number }}</span>
            <p class="text-sm text-surface-500 mt-0.5">{{ invoice?.storeDisplayName }} · {{ invoice?.date | date:'dd/MM/yyyy' }}</p>
          </div>
        </div>
      </ng-template>

      <div *ngIf="invoice" class="invoice-body">

        <!-- Client Info -->
        <div class="bg-surface-50 rounded-xl p-4 mb-4 border border-surface-200 w-full overflow-hidden">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div class="truncate">
              <span class="text-surface-500 block text-xs uppercase tracking-wide mb-0.5">Cliente</span>
              <span class="font-semibold text-surface-800" [title]="invoice.client">{{ invoice.client }}</span>
            </div>
            <div class="truncate">
              <span class="text-surface-500 block text-xs uppercase tracking-wide mb-0.5">Identificación</span>
              <span class="font-semibold text-surface-800">{{ invoice.clientId || '—' }}</span>
            </div>
            <div *ngIf="invoice.seller" class="truncate">
              <span class="text-surface-500 block text-xs uppercase tracking-wide mb-0.5">Vendedor</span>
              <span class="font-semibold text-surface-800" [title]="invoice.seller">{{ invoice.seller }}</span>
            </div>
            <div>
              <span class="text-surface-500 block text-xs uppercase tracking-wide mb-0.5">Estado</span>
              <p-tag [value]="invoice.billingStatus === 'facturada' ? 'Facturada' : 'Pendiente'"
                [severity]="invoice.billingStatus === 'facturada' ? 'success' : 'warn'">
              </p-tag>
            </div>
          </div>
        </div>

        <!-- Payment Methods -->
        <div *ngIf="invoice.paymentBankAccounts?.length" class="bg-blue-50 rounded-xl p-4 mb-4 border border-blue-200">
          <h4 class="text-xs font-bold text-blue-700 uppercase tracking-wide mb-2">
            <i class="pi pi-credit-card mr-1"></i> Medios de Pago
          </h4>
          <div class="flex flex-wrap gap-2">
            <div *ngFor="let payment of invoice.paymentBankAccounts"
              class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border"
              [class.bg-blue-100]="!isCash(payment.bankName)"
              [class.text-blue-800]="!isCash(payment.bankName)"
              [class.border-blue-200]="!isCash(payment.bankName)"
              [class.bg-surface-100]="isCash(payment.bankName)"
              [class.text-surface-600]="isCash(payment.bankName)"
              [class.border-surface-200]="isCash(payment.bankName)">
              <i class="pi" [class.pi-wallet]="isCash(payment.bankName)" [class.pi-building]="!isCash(payment.bankName)"></i>
              <span class="font-medium">{{ payment.bankName }}</span>
              <span class="text-xs opacity-70">{{ payment.amount | currency:'COP':'symbol':'1.0-0' }}</span>
            </div>
          </div>
        </div>

        <!-- Items Table -->
        <div class="mb-4">
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-sm font-bold text-surface-700 uppercase tracking-wide">
              Productos ({{ selectedCount }} de {{ invoice.items.length }} seleccionados)
            </h4>
            <div class="flex gap-2">
              <button pButton label="Todos" class="p-button-text p-button-sm p-button-secondary"
                (click)="selectAll()" pTooltip="Seleccionar todos"></button>
              <button pButton label="Ninguno" class="p-button-text p-button-sm p-button-secondary"
                (click)="deselectAll()" pTooltip="Deseleccionar todos"></button>
            </div>
          </div>

          <div class="border border-surface-200 rounded-xl overflow-x-auto">
            <div class="min-w-[500px]">
              <div class="grid grid-cols-[40px_1fr_80px_100px_100px] bg-surface-50 text-xs font-semibold text-surface-500 uppercase tracking-wide px-4 py-2.5 border-b border-surface-200">
                <div></div>
                <div>Producto</div>
                <div class="text-center">Cant.</div>
                <div class="text-right">Precio</div>
                <div class="text-right">Total</div>
              </div>

              <div *ngFor="let item of editableItems; let last = last"
                class="grid grid-cols-[40px_1fr_80px_100px_100px] items-center px-4 py-3 transition-colors"
                [class.bg-white]="item.selected"
                [class.bg-surface-50]="!item.selected"
                [class.opacity-50]="!item.selected"
                [class.border-b]="!last"
                [class.border-surface-100]="!last">

                <div>
                  <p-checkbox [(ngModel)]="item.selected" [binary]="true"></p-checkbox>
                </div>
                <div>
                  <span class="text-sm font-medium text-surface-800" [class.line-through]="!item.selected">{{ item.name }}</span>
                  <span *ngIf="item.description" class="block text-xs text-surface-400 mt-0.5 truncate max-w-[300px]">{{ item.description }}</span>
                </div>
                <div class="text-center text-sm text-surface-600">{{ item.quantity }}</div>
                <div class="text-right text-sm text-surface-600">{{ item.price | currency:'COP':'symbol':'1.0-0' }}</div>
                <div class="text-right text-sm font-semibold" [class.text-surface-800]="item.selected" [class.text-surface-400]="!item.selected">
                  {{ item.total | currency:'COP':'symbol':'1.0-0' }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Totals -->
        <div class="bg-surface-50 rounded-xl p-4 border border-surface-200">
          <div class="flex justify-between text-sm text-surface-600 mb-2">
            <span>Subtotal (seleccionados)</span>
            <span class="font-medium">{{ selectedSubtotal | currency:'COP':'symbol':'1.0-0' }}</span>
          </div>
          <p-divider></p-divider>
          <div class="flex justify-between text-base font-bold text-surface-900 mt-2">
            <span>Total a facturar</span>
            <span class="text-primary-600">{{ selectedSubtotal | currency:'COP':'symbol':'1.0-0' }}</span>
          </div>
          <div *ngIf="selectedCount < invoice.items.length" class="text-xs text-surface-400 text-right mt-1">
            Total original: {{ invoice.total | currency:'COP':'symbol':'1.0-0' }}
          </div>
        </div>

        <!-- Observations -->
        <div *ngIf="invoice.observations" class="mt-4 text-sm text-surface-500 italic bg-surface-50 rounded-lg p-3 border border-surface-100">
          <i class="pi pi-info-circle mr-1"></i> {{ invoice.observations }}
        </div>
      </div>

      <!-- Footer -->
      <ng-template pTemplate="footer">
        <div class="flex justify-between w-full items-center">
          <button pButton label="Cerrar" icon="pi pi-times" class="p-button-text p-button-secondary"
            (click)="onClose()"></button>

          <div class="flex items-center gap-2">
            <span *ngIf="saving" class="text-sm text-surface-400"><i class="pi pi-spin pi-spinner mr-1"></i> Guardando...</span>
            <button pButton [label]="'Guardar selección (' + selectedCount + ')'" icon="pi pi-save"
              class="p-button-primary shadow-sm" (click)="confirmSelection()"
              [disabled]="saving"
              pTooltip="Guardar los productos seleccionados para facturación">
            </button>
          </div>
        </div>
      </ng-template>

    </p-dialog>
  `,
  styles: [`
    :host ::ng-deep .invoice-detail-dialog .p-dialog-content {
      padding: 1.5rem;
      overflow-y: auto;
    }
    :host ::ng-deep .invoice-detail-dialog .p-dialog-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid #e2e8f0;
    }
    :host ::ng-deep .invoice-detail-dialog .p-dialog-footer {
      padding: 1rem 1.5rem;
      border-top: 1px solid #e2e8f0;
    }
  `]
})
export class InvoiceDetailModalComponent implements OnChanges {
  @Input() visible = false;
  @Input() invoice: BillingInvoice | null = null;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() onConfirm = new EventEmitter<InvoiceItem[]>();
  @Output() onSaved = new EventEmitter<void>();

  editableItems: (InvoiceItem & { selected: boolean })[] = [];
  saving = false;

  constructor(private billingService: ElectronicBillingService) { }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['invoice'] && this.invoice) {
      const savedIds = this.invoice.selectedItemIds;
      this.editableItems = this.invoice.items.map(item => ({
        ...item,
        selected: savedIds ? savedIds.includes(String(item.id)) : true
      }));
    }
  }

  isCash(bankName: string): boolean {
    if (!bankName) return false;
    const lower = bankName.toLowerCase().trim();
    return CASH_KEYWORDS.some(keyword => lower.includes(keyword));
  }

  get selectedCount(): number {
    return this.editableItems.filter(i => i.selected).length;
  }

  get selectedSubtotal(): number {
    return this.editableItems.filter(i => i.selected).reduce((sum, i) => sum + i.total, 0);
  }

  selectAll() {
    this.editableItems.forEach(i => i.selected = true);
  }

  deselectAll() {
    this.editableItems.forEach(i => i.selected = false);
  }

  onClose() {
    this.visible = false;
    this.visibleChange.emit(false);
  }

  confirmSelection() {
    if (!this.invoice) return;

    this.saving = true;
    const selectedIds = this.editableItems
      .filter(i => i.selected)
      .map(i => String(i.id));

    this.billingService.updateSelectedItems(this.invoice.id, this.invoice.store, selectedIds)
      .subscribe({
        next: () => {
          this.saving = false;
          if (this.invoice) {
            this.invoice.selectedItemIds = selectedIds;
            this.invoice.selectedItemsCount = selectedIds.length;
          }
          this.onConfirm.emit(this.editableItems.filter(i => i.selected));
          this.onSaved.emit();
          this.onClose();
        },
        error: () => {
          this.saving = false;
        }
      });
  }
}
