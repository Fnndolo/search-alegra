import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { DropdownModule } from 'primeng/dropdown';
import { MultiSelectModule } from 'primeng/multiselect';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';
import { TagModule } from 'primeng/tag';
import { DatePickerModule } from 'primeng/datepicker';
import { BillingWizardComponent } from '../billing-wizard/billing-wizard.component';
import { InvoiceDetailModalComponent } from '../invoice-detail-modal/invoice-detail-modal.component';
import { KupocellInvoiceModalComponent } from '../kupocell-invoice-modal/kupocell-invoice-modal.component';
import { ElectronicBillingService, BillingInvoice, InvoiceItem } from '../services/electronic-billing.service';

@Component({
  selector: 'app-invoice-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    DropdownModule,
    MultiSelectModule,
    InputTextModule,
    InputNumberModule,
    ButtonModule,
    ToastModule,
    TooltipModule,
    TagModule,
    DatePickerModule,
    BillingWizardComponent,
    InvoiceDetailModalComponent,
    KupocellInvoiceModalComponent
  ],
  providers: [MessageService],
  templateUrl: './invoice-list.component.html',
  styleUrl: './invoice-list.component.scss'
})
export class InvoiceListComponent implements OnInit {
  allInvoices = signal<BillingInvoice[]>([]);
  selectedInvoices: BillingInvoice[] = [];
  loading = signal<boolean>(true);

  // --- Filters ---
  searchText = '';

  // Status
  selectedStatus: string | null = null;
  statuses = [
    { label: 'Todos los estados', value: null },
    { label: 'Pendiente', value: 'pendiente' },
    { label: 'Facturada', value: 'facturada_all' }
  ];

  // Store
  selectedStore: string | null = null;
  storeOptions = signal<{ label: string, value: string }[]>([]);

  // Product (multi-select with search)
  selectedProducts: string[] = [];
  productOptions = signal<{ label: string, value: string }[]>([]);

  // Date range
  dateFrom: Date | null = null;
  dateTo: Date | null = null;

  // Price range
  priceFrom: number | null = null;
  priceTo: number | null = null;

  // Pagination
  page = 0;
  rows = 30;

  // Computed filtered invoices
  filteredInvoices = computed(() => {
    let data = this.allInvoices();

    // Search text
    if (this.searchText && this.searchText.trim()) {
      const term = this.searchText.toLowerCase().trim();
      data = data.filter(inv =>
        (inv.number?.toString() || '').toLowerCase().includes(term) ||
        (inv.client || '').toLowerCase().includes(term) ||
        (inv.productName || '').toLowerCase().includes(term) ||
        (inv.seller || '').toLowerCase().includes(term) ||
        (inv.clientId || '').toLowerCase().includes(term)
      );
    }

    // Status
    if (this.selectedStatus) {
      if (this.selectedStatus === 'facturada_all') {
        data = data.filter(inv => inv.billingStatus === 'facturada' || inv.billingStatus === 'facturada_sistema');
      } else {
        data = data.filter(inv => inv.billingStatus === this.selectedStatus);
      }
    }

    // Store
    if (this.selectedStore) {
      data = data.filter(inv => inv.store === this.selectedStore);
    }

    // Products
    if (this.selectedProducts.length > 0) {
      data = data.filter(inv => this.selectedProducts.includes(inv.productName));
    }

    // Date range
    if (this.dateFrom) {
      const from = new Date(this.dateFrom);
      from.setHours(0, 0, 0, 0);
      data = data.filter(inv => {
        const d = new Date(inv.date);
        return d >= from;
      });
    }
    if (this.dateTo) {
      const to = new Date(this.dateTo);
      to.setHours(23, 59, 59, 999);
      data = data.filter(inv => {
        const d = new Date(inv.date);
        return d <= to;
      });
    }

    // Price range
    if (this.priceFrom !== null && this.priceFrom !== undefined) {
      data = data.filter(inv => inv.total >= this.priceFrom!);
    }
    if (this.priceTo !== null && this.priceTo !== undefined) {
      data = data.filter(inv => inv.total <= this.priceTo!);
    }

    return data;
  });

  constructor(
    private messageService: MessageService,
    private billingService: ElectronicBillingService
  ) { }

  ngOnInit() {
    this.loadInvoices();
  }

  loadInvoices() {
    this.loading.set(true);

    this.billingService.getInvoices().subscribe({
      next: (res) => {
        this.allInvoices.set(res.data);
        this.buildFilterOptions(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'No se pudieron cargar las facturas'
        });
      }
    });
  }

  private buildFilterOptions(data: BillingInvoice[]) {
    // Store options
    const storesSet = new Set(data.map(inv => inv.store));
    this.storeOptions.set(
      [{ label: 'Todas las tiendas', value: '' },
      ...Array.from(storesSet).map(s => {
        const display = data.find(inv => inv.store === s)?.storeDisplayName || s;
        return { label: display, value: s };
      })]
    );

    // Product options (unique product names)
    const productsSet = new Set(data.map(inv => inv.productName).filter(Boolean));
    this.productOptions.set(
      Array.from(productsSet).sort().map(p => ({ label: p, value: p }))
    );
  }

  // Trigger re-computation
  applyFilters() {
    // Force signal update to recompute filtered list
    this.allInvoices.update(v => [...v]);
  }

  clearFilters() {
    this.searchText = '';
    this.selectedStatus = null;
    this.selectedStore = null;
    this.selectedProducts = [];
    this.dateFrom = null;
    this.dateTo = null;
    this.priceFrom = null;
    this.priceTo = null;
    this.selectedInvoices = [];
    this.applyFilters();
  }

  get hasActiveFilters(): boolean {
    return !!(this.searchText || this.selectedStatus || this.selectedStore ||
      this.selectedProducts.length > 0 || this.dateFrom || this.dateTo ||
      this.priceFrom !== null || this.priceTo !== null);
  }

  /** 'pendiente' = all selected are pendiente, 'facturada' = all are facturada manually, 'facturada_sistema' = has system generated invoice, 'mixed' = mix */
  get selectionMode(): 'pendiente' | 'facturada' | 'facturada_sistema' | 'mixed' | null {
    if (this.selectedInvoices.length === 0) return null;
    const allPendiente = this.selectedInvoices.every(inv => inv.billingStatus === 'pendiente');
    const allFacturadaManual = this.selectedInvoices.every(inv => inv.billingStatus === 'facturada');
    const hasSistema = this.selectedInvoices.some(inv => inv.billingStatus === 'facturada_sistema');

    if (allPendiente) return 'pendiente';
    if (hasSistema) return 'facturada_sistema';
    if (allFacturadaManual) return 'facturada';
    return 'mixed';
  }

  /** Marca las facturas seleccionadas como facturada */
  markAsFacturada() {
    const selected = this.selectedInvoices;
    if (selected.length === 0) {
      this.messageService.add({ severity: 'warn', summary: 'Alerta', detail: 'Seleccione al menos una factura.' });
      return;
    }

    const ids = selected.map(inv => ({ id: inv.id, store: inv.store }));

    this.billingService.updateStatus(ids, 'facturada').subscribe({
      next: (res) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Éxito',
          detail: `${res.updatedCount} factura(s) marcada(s) como facturada(s)`
        });
        this.selectedInvoices = [];
        this.loadInvoices();
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Error al actualizar estado' });
      }
    });
  }

  jumpToPage(event: any) {
    const targetPage = parseInt(event.target.value, 10);
    const totalRecords = this.filteredInvoices().length;
    const maxPage = Math.ceil(totalRecords / this.rows);
    if (!isNaN(targetPage) && targetPage > 0 && targetPage <= maxPage) {
      this.page = targetPage - 1;
    } else {
      event.target.value = this.page + 1;
    }
  }

  goToPage(p: number) {
    this.page = p;
  }

  get totalPages(): number {
    return Math.ceil(this.filteredInvoices().length / this.rows) || 1;
  }

  get visiblePages(): number[] {
    const total = this.totalPages;
    const current = this.page + 1;
    const pages = [];
    let start = Math.max(1, current - 2);
    let end = Math.min(total, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  /** Marca las facturas seleccionadas como pendiente */
  markAsPendiente() {
    const selected = this.selectedInvoices;
    if (selected.length === 0) {
      this.messageService.add({ severity: 'warn', summary: 'Alerta', detail: 'Seleccione al menos una factura.' });
      return;
    }

    const ids = selected.map(inv => ({ id: inv.id, store: inv.store }));

    this.billingService.updateStatus(ids, 'pendiente').subscribe({
      next: (res) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Éxito',
          detail: `${res.updatedCount} factura(s) marcada(s) como pendiente(s)`
        });
        this.selectedInvoices = [];
        this.loadInvoices();
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Error al actualizar estado' });
      }
    });
  }

  // Detail modal
  isDetailVisible = false;
  detailInvoice: BillingInvoice | null = null;

  openDetail(invoice: BillingInvoice) {
    this.detailInvoice = invoice;
    this.isDetailVisible = true;
  }

  onDetailConfirm(selectedItems: InvoiceItem[]) {
    this.messageService.add({
      severity: 'info',
      summary: 'Selección confirmada',
      detail: `${selectedItems.length} producto(s) seleccionado(s) para facturación`
    });
    // TODO: store selected items per invoice for batch processing
  }

  // Drawer
  isWizardVisible = false;

  openBillingDrawer() {
    const pending = this.selectedInvoices.filter(inv => inv.billingStatus === 'pendiente');
    if (pending.length === 0) {
      this.messageService.add({ severity: 'warn', summary: 'Alerta', detail: 'Seleccione al menos una factura con estado pendiente.' });
      return;
    }
    this.isWizardVisible = true;
  }

  onWizardProcess(payload: any) {
    this.messageService.add({
      severity: 'success',
      summary: 'Procesamiento Iniciado',
      detail: `Lote de ${this.selectedInvoices.length} enviado a Alegra.`
    });
    this.selectedInvoices = [];
    this.loadInvoices();
  }

  // Kupocell modal
  isKupocellModalVisible = false;

  openKupocellModal() {
    const pending = this.selectedInvoices.filter(inv => inv.billingStatus === 'pendiente');
    if (pending.length === 0) {
      this.messageService.add({ severity: 'warn', summary: 'Alerta', detail: 'Seleccione al menos una factura pendiente.' });
      return;
    }
    this.isKupocellModalVisible = true;
  }

  onKupocellComplete() {
    this.selectedInvoices = [];
    this.loadInvoices();
    this.messageService.add({
      severity: 'success',
      summary: 'Facturación completada',
      detail: 'Las facturas han sido procesadas en Kupocell'
    });
  }

  getStatusSeverity(status: string): "success" | "warn" | "info" {
    return (status === 'facturada' || status === 'facturada_sistema') ? 'success' : 'warn';
  }
}
