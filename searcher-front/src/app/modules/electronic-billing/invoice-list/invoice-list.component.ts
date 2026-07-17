import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
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
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
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
export class InvoiceListComponent implements OnInit, OnDestroy {
  allInvoices = signal<BillingInvoice[]>([]);
  totalRecords = 0;
  selectedInvoices: BillingInvoice[] = [];
  loading = signal<boolean>(false);

  searchText = '';

  selectedStatus: string | null = null;
  statuses = [
    { label: 'Todos los estados', value: null },
    { label: 'Pendiente', value: 'pendiente' },
    { label: 'Facturada', value: 'facturada_all' }
  ];

  selectedStore = '';
  storeOptions = [
    { label: 'Todas las tiendas', value: '' },
    { label: 'Smart Gadgets Pasto', value: 'pasto' },
    { label: 'Smart Gadgets Medellín', value: 'medellin' },
    { label: 'Smart Gadgets Armenia', value: 'armenia' },
    { label: 'Smart Gadgets Pereira', value: 'pereira' },
    { label: 'Smart Gadgets Bogotá', value: 'bogota' },
  ];

  selectedProducts: string[] = [];
  productOptions = signal<{ label: string, value: string }[]>([]);

  dateFrom: Date | null = null;
  dateTo: Date | null = null;
  priceFrom: number | null = null;
  priceTo: number | null = null;

  page = 0;
  rows = 30;

  private searchSubject = new Subject<string>();
  private searchSubscription: Subscription | null = null;

  filteredInvoices = computed(() => {
    let data = this.allInvoices();
    if (this.selectedProducts.length > 0) {
      data = data.filter(inv => this.selectedProducts.includes(inv.productName));
    }
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
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(() => {
      this.page = 0;
      this.loadInvoices();
    });
  }

  ngOnDestroy() {
    this.searchSubscription?.unsubscribe();
  }

  loadInvoices() {
    this.loading.set(true);
    this.billingService.getInvoices(
      this.selectedStatus ?? undefined,
      this.selectedStore || undefined,
      this.page + 1,
      this.rows,
      this.searchText?.trim() || undefined,
      this.dateFrom,
      this.dateTo,
    ).subscribe({
      next: (res) => {
        this.allInvoices.set(res.data);
        this.totalRecords = res.total;
        const productsSet = new Set(res.data.map((inv: BillingInvoice) => inv.productName).filter(Boolean));
        this.productOptions.set(
          Array.from(productsSet).sort().map((p: any) => ({ label: p, value: p }))
        );
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

  onSearchChange() {
    this.searchSubject.next(this.searchText);
  }

  onFilterChange() {
    this.page = 0;
    this.loadInvoices();
  }

  onLocalFilterChange() {
    this.allInvoices.update(v => [...v]);
  }

  applyFilters() {
    this.allInvoices.update(v => [...v]);
  }

  clearFilters() {
    this.searchText = '';
    this.selectedStatus = null;
    this.selectedStore = '';
    this.selectedProducts = [];
    this.dateFrom = null;
    this.dateTo = null;
    this.priceFrom = null;
    this.priceTo = null;
    this.page = 0;
    this.selectedInvoices = [];
    this.loadInvoices();
  }

  get hasActiveFilters(): boolean {
    return !!(this.searchText?.trim() || this.selectedStatus || this.selectedStore ||
      this.selectedProducts.length > 0 || this.dateFrom || this.dateTo ||
      this.priceFrom !== null || this.priceTo !== null);
  }

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
    const maxPage = Math.ceil(this.totalRecords / this.rows);
    if (!isNaN(targetPage) && targetPage > 0 && targetPage <= maxPage) {
      this.page = targetPage - 1;
      this.loadInvoices();
    } else {
      event.target.value = this.page + 1;
    }
  }

  goToPage(p: number) {
    this.page = p;
    this.loadInvoices();
  }

  get totalPages(): number {
    return Math.ceil(this.totalRecords / this.rows) || 1;
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
  }

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
