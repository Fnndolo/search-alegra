import { Component, Input, Output, EventEmitter, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SidebarModule } from 'primeng/sidebar';
import { DropdownModule } from 'primeng/dropdown';
import { MultiSelectModule } from 'primeng/multiselect';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';

@Component({
  selector: 'app-billing-wizard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SidebarModule,
    DropdownModule,
    MultiSelectModule,
    ButtonModule,
    ProgressBarModule
  ],
  templateUrl: './billing-wizard.component.html',
  styleUrl: './billing-wizard.component.scss'
})
export class BillingWizardComponent {

  @Input() visible = false;
  @Input() selectedCount = 0;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() onProcess = new EventEmitter<any>();

  // Mocked Metadata state
  warehouses = signal<any[]>([
    { id: '1', name: 'Bodega Principal Kupocell' },
    { id: '2', name: 'Bodega Auxiliar' }
  ]);

  taxes = signal<any[]>([
    { id: '1', name: 'IVA 19%', percentage: 19 },
    { id: '2', name: 'IVA 5%', percentage: 5 },
    { id: '3', name: 'ReteFuente 2.5%', percentage: 2.5 }
  ]);

  costCenters = signal<any[]>([
    { id: '1', name: 'Ventas Nacionales' },
    { id: '2', name: 'Ventas Mostrador' }
  ]);

  // Form State
  selectedWarehouse = signal<any>(null);
  selectedCostCenter = signal<any>(null);
  selectedTaxes = signal<any[]>([]);

  // Processing visual state
  isProcessing = signal<boolean>(false);
  progress = signal<number>(0);

  close() {
    if (!this.isProcessing()) {
      this.visible = false;
      this.visibleChange.emit(this.visible);
    }
  }

  startBilling() {
    if (!this.selectedWarehouse()) return;

    this.isProcessing.set(true);
    this.progress.set(10);

    // Simulate batch progress
    const interval = setInterval(() => {
      const cur = this.progress();
      if (cur >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          this.isProcessing.set(false);
          this.onProcess.emit({
            warehouseId: this.selectedWarehouse().id,
            costCenterId: this.selectedCostCenter()?.id,
            taxes: this.selectedTaxes()
          });
          this.close();
        }, 500);
      } else {
        this.progress.update(p => Math.min(p + 20, 100));
      }
    }, 400);
  }
}
