import { Component, Input, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { TooltipModule } from 'primeng/tooltip';
import { InventoryApiService } from '../../services/inventory-api.service';
import { BarcodeScannerModalComponent } from '../../shared/barcode-scanner-modal/barcode-scanner-modal.component';

@Component({
  selector: 'app-imei-search-modal',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ButtonModule, DialogModule,
    InputTextModule, TagModule, ToastModule, IconFieldModule, InputIconModule,
    TooltipModule, BarcodeScannerModalComponent
  ],
  providers: [MessageService],
  templateUrl: './imei-search-modal.component.html'
})
export class ImeiSearchModalComponent {
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();

  identifier = '';
  loading = false;
  result: any = null;
  notFound = false;
  scannerVisible = false;

  constructor(
    private api: InventoryApiService,
    private messageService: MessageService,
    private cdr: ChangeDetectorRef,
  ) {}

  close() {
    this.visible = false;
    this.visibleChange.emit(false);
    this.identifier = '';
    this.result = null;
    this.notFound = false;
  }

  search() {
    if (!this.identifier.trim()) return;
    this.loading = true;
    this.result = null;
    this.notFound = false;
    this.api.buscarPorImei(this.identifier.trim()).subscribe({
      next: (res) => {
        this.loading = false;
        this.result = res;
        this.cdr.detectChanges();
      },
      error: (e) => {
        this.loading = false;
        if (e?.status === 404) {
          this.notFound = true;
        } else {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo buscar el identificador' });
        }
        this.cdr.detectChanges();
      }
    });
  }

  /** Variant no longer tracks a granular estado — just active/inactive (exit_date set). */
  getEstadoSeverity(active: boolean): 'success' | 'secondary' {
    return active ? 'success' : 'secondary';
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') this.search();
  }

  onBarcodeScanned(code: string): void {
    this.identifier = code;
    this.search();
  }
}
