import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { PaginatorModule } from 'primeng/paginator';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { InvoiceService } from '../../../core/http/invoice.service';
import { SocketService } from '../../../core/services/socket.service';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { DropdownModule } from 'primeng/dropdown';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ToastModule } from 'primeng/toast';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { MultiSelectModule } from 'primeng/multiselect';
import { MessageService } from 'primeng/api';
import { Subscription, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { HighlightPipe } from '../../../core/pipes/highlight.pipe';
import { ProfileMenuComponent } from '../../../layout/profile-menu/profile-menu.component';

@Component({
  selector: 'app-invoices',
  standalone: true,
  imports: [
    CommonModule,
    TableModule,
    InputTextModule,
    PaginatorModule,
    FormsModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    DropdownModule,
    TagModule,
    TooltipModule,
    ToastModule,
    DatePickerModule,
    InputNumberModule,
    MultiSelectModule,
    HighlightPipe,
    ProfileMenuComponent
  ],
  providers: [InvoiceService, SocketService, MessageService],
  templateUrl: './invoices.component.html',
  // styleUrls: ['./invoices.component.scss']
})
export class InvoicesComponent implements OnInit, OnDestroy {
  invoices: any[] = [];
  allInvoices: any[] = [];
  totalRecords = 0;
  loading = false;
  updating = false;
  progress = 0;
  page = 0;
  rows = 30;
  filterValue = '';

  // Nueva propiedad para almacenar facturas de compra (para búsqueda de costos)
  private purchaseInvoicesCache: any[] = [];

  // Propiedades para WebSocket
  private socketSubscriptions: Subscription[] = [];
  private searchSubject = new Subject<string>();
  private searchSubscription: Subscription | null = null;
  newInvoiceIds: string[] = []; // Para rastrear facturas nuevas y animarlas
  deletedInvoiceIds: string[] = []; // Para rastrear facturas eliminadas y animarlas

  // Nuevas propiedades para el selector
  invoiceTypes = [
    { label: 'Facturas de Venta', value: 'sales' },
    { label: 'Facturas de Compra', value: 'purchases' }
  ];
  selectedInvoiceType = '';

  // Propiedades para el selector de tiendas
  stores = [
    { label: 'Smart Gadgets Pasto', value: 'pasto' },
    { label: 'Smart Gadgets Medellín', value: 'medellin' },
    { label: 'Smart Gadgets Armenia', value: 'armenia' },
    { label: 'Smart Gadgets Pereira', value: 'pereira' },
    { label: 'Smart Gadgets Bogotá', value: 'bogota' },
    { label: 'Todas las tiendas', value: 'todas' }
  ];
  selectedStore = '';

  // Propiedades para búsqueda masiva
  showMassiveSearchModal = false;
  massiveSearchText = '';
  massiveSearchResults: any = null;
  massiveSearchLoading = false;

  // Nuevos filtros equivalentes a invoice-list
  dateFrom: Date | null = null;
  dateTo: Date | null = null;
  selectedStatus: string | null = null;
  statuses = [
    { label: 'Todos los estados', value: null },
    { label: 'Por cobrar', value: 'open' },
    { label: 'Cobrada', value: 'closed' },
    { label: 'Borrador', value: 'draft' },
    { label: 'Anulada', value: 'void' }
  ];

  // Propiedades para exportación de datos
  showExportModal: boolean = false;
  exportStartDate: string = '';
  exportEndDate: string = '';
  exportLoading: boolean = false;

  constructor(
    private invoiceService: InvoiceService,
    private socketService: SocketService,
    private cdr: ChangeDetectorRef,
    private messageService: MessageService
  ) {
  }

  ngOnInit() {
    // Leer parámetros guardados de sessionStorage
    const savedStore = sessionStorage.getItem('selectedStore');
    const savedType = sessionStorage.getItem('selectedInvoiceType');

    if (savedStore) {
      this.selectedStore = savedStore;
    }
    if (savedType) {
      this.selectedInvoiceType = savedType;
    }

    this.loadInvoices();

    // Conectar WebSocket y suscribirse a eventos
    if (this.selectedStore && this.selectedInvoiceType) {
      this.connectWebSocket();
    }

    // Configurar debounce para búsqueda
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(() => {
      this.page = 0;
      this.filterInvoicesLocal();
    });
  }

  ngOnDestroy() {
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    if (this.searchSubscription) {
      this.searchSubscription.unsubscribe();
    }
  }

  connectWebSocket() {
    // Solo conectar si no está conectado
    if (!this.socketService.isConnected()) {
      this.socketService.connect();
    }

    // Limpiar suscripciones anteriores antes de crear nuevas
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    this.socketSubscriptions = [];

    // Unirse a la sala específica de esta tienda y tipo
    if (this.selectedStore && this.selectedInvoiceType) {
      this.socketService.joinRoom(this.selectedStore, this.selectedInvoiceType);
    }

    // Suscribirse a eventos según el tipo de factura
    if (this.selectedInvoiceType === 'sales') {
      // Eventos para facturas de VENTA
      const createdSub = this.socketService.onInvoiceCreated().subscribe({
        next: (invoice) => this.handleInvoiceCreated(invoice)
      });

      const updatedSub = this.socketService.onInvoiceUpdated().subscribe({
        next: (invoice) => this.handleInvoiceUpdated(invoice)
      });

      const deletedSub = this.socketService.onInvoiceDeleted().subscribe({
        next: (invoiceId) => this.handleInvoiceDeleted(invoiceId)
      });

      this.socketSubscriptions.push(createdSub, updatedSub, deletedSub);

    } else if (this.selectedInvoiceType === 'purchases') {
      // Eventos para facturas de COMPRA
      const createdSub = this.socketService.onBillCreated().subscribe({
        next: (bill: any) => this.handleInvoiceCreated(bill)
      });

      const updatedSub = this.socketService.onBillUpdated().subscribe({
        next: (bill: any) => this.handleInvoiceUpdated(bill)
      });

      const deletedSub = this.socketService.onBillDeleted().subscribe({
        next: (billId) => this.handleInvoiceDeleted(billId)
      });

      this.socketSubscriptions.push(createdSub, updatedSub, deletedSub);
    }
  }

  disconnectWebSocket() {
    // Salir de la sala actual
    if (this.selectedStore && this.selectedInvoiceType) {
      this.socketService.leaveRoom(this.selectedStore, this.selectedInvoiceType);
    }

    // Desuscribirse de todos los eventos
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    this.socketSubscriptions = [];

    // Desconectar socket
    this.socketService.disconnect();
  }

  handleInvoiceCreated(invoice: any) {
    // Evitar duplicados por webhooks repetidos
    const exists = this.allInvoices.some(inv => inv.id === invoice.id);
    if (exists) {
      return this.handleInvoiceUpdated(invoice);
    }

    // Agregar la nueva factura al inicio del array
    this.allInvoices.unshift(invoice);
    this.totalRecords = this.allInvoices.length;

    // Marcar como nueva para animación
    this.newInvoiceIds.push(invoice.id);

    // Aplicar filtro si existe
    if (this.filterValue && this.filterValue.trim() !== '') {
      this.filterInvoicesLocal();
    } else {
      this.invoices = this.allInvoices.slice(0, this.rows);
    }

    // Forzar detección de cambios
    this.cdr.detectChanges();

    // Remover animación después de 2 segundos
    setTimeout(() => {
      const index = this.newInvoiceIds.indexOf(invoice.id);
      if (index > -1) {
        this.newInvoiceIds.splice(index, 1);
      }
      this.cdr.detectChanges();
    }, 2000);
  }

  handleInvoiceUpdated(invoice: any) {
    // Encontrar y actualizar la factura existente
    const index = this.allInvoices.findIndex(inv => inv.id === invoice.id);
    if (index !== -1) {
      this.allInvoices[index] = invoice;

      // Aplicar filtro si existe
      if (this.filterValue && this.filterValue.trim() !== '') {
        this.filterInvoicesLocal();
      } else {
        this.invoices = this.allInvoices.slice(this.page * this.rows, (this.page + 1) * this.rows);
      }

      // Forzar detección de cambios
      this.cdr.detectChanges();
    }
  }

  handleInvoiceDeleted(data: any) {
    // Manejar tanto el formato simple (ID) como el formato de "todas" (objeto)
    const invoiceId = typeof data === 'object' ? data.id : data;
    const storeKey = typeof data === 'object' ? data.storeKey : this.selectedStore;

    // Marcar como eliminada para animación ANTES de eliminar
    this.deletedInvoiceIds.push(invoiceId);

    // Forzar detección de cambios para mostrar animación
    this.cdr.detectChanges();

    // Esperar a que la animación se vea antes de eliminar
    setTimeout(() => {
      // Eliminar la factura del array
      this.allInvoices = this.allInvoices.filter(inv => {
        if (this.selectedStore === 'todas') {
          // Para "todas", comparar ID y storeKey
          return !(inv.id === invoiceId && inv.storeKey === storeKey);
        }
        // Para tienda específica, solo comparar ID
        return inv.id !== invoiceId;
      });
      this.totalRecords = this.allInvoices.length;

      // Aplicar filtro si existe
      if (this.filterValue && this.filterValue.trim() !== '') {
        this.filterInvoicesLocal();
      } else {
        this.invoices = this.allInvoices.slice(this.page * this.rows, (this.page + 1) * this.rows);
      }

      // Remover de la lista de eliminadas
      const index = this.deletedInvoiceIds.indexOf(invoiceId);
      if (index > -1) {
        this.deletedInvoiceIds.splice(index, 1);
      }

      // Forzar detección de cambios
      this.cdr.detectChanges();
    }, 800); // Duración de la animación
  }

  loadInvoices() {
    this.loading = true;
    // Aquí llamaremos diferentes métodos según el tipo seleccionado
    if (this.selectedInvoiceType === 'sales') {
      this.loadSalesInvoices();
    } else {
      this.loadPurchaseInvoices();
    }
  }

  loadSalesInvoices() {
    this.invoiceService.getAllInvoices(this.selectedStore).subscribe({
      next: (res) => {
        this.updating = res.updating;
        this.progress = res.progress;
        this.allInvoices = res.data || [];
        this.totalRecords = this.allInvoices.length;
        this.loading = false;

        // Aplicar filtro automáticamente si hay filtros activos
        if (this.hasActiveFilters) {
          this.filterInvoicesLocal();
        } else {
          this.invoices = this.allInvoices.slice(0, this.rows);
        }
      },
      error: (error) => {
        this.loading = false;
        this.allInvoices = [];
        this.invoices = [];
        this.totalRecords = 0;
      }
    });
  }

  loadPurchaseInvoices() {
    // Usando el service para facturas de compra
    this.invoiceService.getAllPurchaseInvoices(this.selectedStore).subscribe({
      next: (res) => {
        this.updating = res.updating;
        this.progress = res.progress;
        this.allInvoices = res.data || [];
        this.totalRecords = this.allInvoices.length;
        this.loading = false;

        // Aplicar filtro automáticamente si hay filtros activos
        if (this.hasActiveFilters) {
          this.filterInvoicesLocal();
        } else {
          this.invoices = this.allInvoices.slice(0, this.rows);
        }
      },
      error: (error) => {
        this.loading = false;
        this.allInvoices = [];
        this.invoices = [];
        this.totalRecords = 0;
      }
    });
  }

  onInvoiceTypeChange() {
    // Guardar sala anterior antes de cambiar
    const oldStore = this.selectedStore;
    const oldType = this.selectedInvoiceType;

    this.page = 0;
    // NO borramos el filterValue para mantener la búsqueda
    this.allInvoices = [];
    this.invoices = [];
    this.totalRecords = 0;

    // Guardar en sessionStorage (selectedInvoiceType ya cambió por el ngModel)
    sessionStorage.setItem('selectedInvoiceType', this.selectedInvoiceType);

    // Salir de la sala anterior
    if (oldStore && oldType) {
      this.socketService.leaveRoom(oldStore, oldType);
    }

    // Limpiar suscripciones
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    this.socketSubscriptions = [];

    // Conectar a la nueva sala
    if (this.selectedStore && this.selectedInvoiceType) {
      this.connectWebSocket();
    }

    this.loadInvoices();
  }

  onStoreChange() {
    // Guardar sala anterior antes de cambiar
    const oldStore = this.selectedStore;
    const oldType = this.selectedInvoiceType;

    this.page = 0;
    // NO borramos el filterValue para mantener la búsqueda
    this.allInvoices = [];
    this.invoices = [];
    this.totalRecords = 0;

    // Guardar en sessionStorage (selectedStore ya cambió por el ngModel)
    sessionStorage.setItem('selectedStore', this.selectedStore);

    // Salir de la sala anterior
    if (oldStore && oldType) {
      this.socketService.leaveRoom(oldStore, oldType);
    }

    // Limpiar suscripciones
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    this.socketSubscriptions = [];

    // Conectar a la nueva sala
    if (this.selectedStore && this.selectedInvoiceType) {
      this.connectWebSocket();
    }

    this.loadInvoices();
  }

  onFilterChange(immediate: boolean = false) {
    if (immediate) {
      this.page = 0;
      this.filterInvoicesLocal();
    } else {
      this.searchSubject.next(this.filterValue);
    }
  }

  filterInvoicesLocal() {
    if (!this.allInvoices) return;

    let filtered = this.allInvoices;
    const trimmedFilter = this.filterValue?.trim() || '';

    // Filtros de Estado
    if (this.selectedStatus) {
      filtered = filtered.filter((inv) => inv.status === this.selectedStatus);
    }

    // Filtros de Fecha
    if (this.dateFrom) {
      const from = new Date(this.dateFrom);
      from.setHours(0, 0, 0, 0);
      filtered = filtered.filter((inv) => new Date(inv.date) >= from);
    }
    if (this.dateTo) {
      const to = new Date(this.dateTo);
      to.setHours(23, 59, 59, 999);
      filtered = filtered.filter((inv) => new Date(inv.date) <= to);
    }

    if (trimmedFilter !== '') {
      const filterLower = trimmedFilter.toLowerCase();

      if (this.selectedInvoiceType === 'sales') {
        filtered = filtered.filter(
          (inv) => {
            const id = inv.numberTemplate?.number?.toString().toLowerCase() || '';
            const client = inv.client?.name?.toLowerCase() || '';
            const identification = inv.client?.identification?.toString().toLowerCase() || '';
            const shop = inv.tienda?.toLowerCase() || '';
            const annotations = inv.anotation?.toLowerCase() || '';

            if (id.includes(filterLower) || client.includes(filterLower) || identification.includes(filterLower) || shop.includes(filterLower) || annotations.includes(filterLower)) {
              return true;
            }

            return inv.items?.some((item: any) =>
              (item.name?.toLowerCase().includes(filterLower)) ||
              (item.description?.toLowerCase().includes(filterLower))
            );
          }
        );
      } else {
        filtered = filtered.filter(
          (inv) => {
            const id = inv.numberTemplate?.number?.toString().toLowerCase() || '';
            const provider = inv.provider?.name?.toLowerCase() || '';
            const shop = inv.tienda?.toLowerCase() || '';
            const annotations = inv.anotation?.toLowerCase() || '';

            if (id.includes(filterLower) || provider.includes(filterLower) || shop.includes(filterLower) || annotations.includes(filterLower)) {
              return true;
            }

            return inv.purchases?.items?.some((item: any) =>
              (item.name?.toLowerCase().includes(filterLower)) ||
              (item.description?.toLowerCase().includes(filterLower))
            );
          }
        );
      }
    }

    this.totalRecords = filtered.length;
    this.invoices = filtered.slice(this.page * this.rows, (this.page + 1) * this.rows);
    this.cdr.detectChanges();
  }

  get hasActiveFilters(): boolean {
    return !!(this.filterValue?.trim() || this.selectedStatus || this.dateFrom || this.dateTo);
  }

  clearFilters() {
    this.filterValue = '';
    this.selectedStatus = null;
    this.dateFrom = null;
    this.dateTo = null;
    this.page = 0;
    this.filterInvoicesLocal();
  }

  refreshInvoices() {
    this.loading = true;
    if (this.selectedInvoiceType === 'sales') {
      this.invoiceService.updateInvoices(this.selectedStore).subscribe((res) => {
        this.updating = res.updating;
        this.progress = res.progress;
        this.allInvoices = res.data;
        this.totalRecords = this.allInvoices.length;
        this.loading = false;

        // Aplicar filtro automáticamente si hay texto de búsqueda
        if (this.filterValue && this.filterValue.trim() !== '') {
          this.filterInvoicesLocal();
        } else {
          this.invoices = this.allInvoices.slice(0, this.rows);
        }
      });
    } else {
      this.invoiceService.updatePurchaseInvoices(this.selectedStore).subscribe((res) => {
        this.updating = res.updating;
        this.progress = res.progress;
        this.allInvoices = res.data;
        this.totalRecords = this.allInvoices.length;
        this.loading = false;

        // Aplicar filtro automáticamente si hay texto de búsqueda
        if (this.filterValue && this.filterValue.trim() !== '') {
          this.filterInvoicesLocal();
        } else {
          this.invoices = this.allInvoices.slice(0, this.rows);
        }
      });
    }
  }

  loadInvoicesLazy(event: any) {
    this.page = event.first / event.rows;
    this.rows = event.rows;
    this.filterInvoicesLocal();
  }

  jumpToPage(event: any) {
    const targetPage = parseInt(event.target.value, 10);
    const maxPage = Math.ceil(this.totalRecords / this.rows);
    if (!isNaN(targetPage) && targetPage > 0 && targetPage <= maxPage) {
      this.page = targetPage - 1;
      this.filterInvoicesLocal();
    } else {
      // Revertir valor si es inválido
      event.target.value = this.page + 1;
    }
  }

  goToPage(p: number) {
    this.page = p;
    this.filterInvoicesLocal();
  }

  syncMissingPayments() {
    if (!this.selectedStore || this.selectedInvoiceType !== 'sales') return;
    this.loading = true;
    this.messageService.add({ severity: 'info', summary: 'Sincronizando faltantes', detail: 'Descargando facturas recientes sin pagos...' });

    this.invoiceService.syncMissingPayments(this.selectedStore).subscribe({
      next: (res: any) => {
        this.updating = false;
        this.progress = res.progress;
        this.allInvoices = res.data;
        this.totalRecords = this.allInvoices.length;
        this.loading = false;
        
        this.messageService.add({ severity: 'success', summary: 'Éxito', detail: 'Pagos faltantes recuperados con éxito' });

        if (this.filterValue && this.filterValue.trim() !== '') {
          this.filterInvoicesLocal();
        } else {
          this.invoices = this.allInvoices.slice(0, this.rows);
        }
      },
      error: (err: any) => {
        this.loading = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo sincronizar los pagos faltantes' });
      }
    });
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

    if (end - start < 4) {
      start = Math.max(1, end - 4);
    }

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  goToAlegra(id: string) {
    window.open(`https://app.alegra.com/invoice/view/id/${id}`, '_blank');
  }
  goToAlegraBills(id: string) {
    window.open(`https://app.alegra.com/bill/view/id/${id}`, '_blank');
  }

  // Métodos para búsqueda masiva
  openMassiveSearchModal() {
    this.showMassiveSearchModal = true;
    this.massiveSearchText = '';
    this.massiveSearchResults = null;
  }

  closeMassiveSearchModal() {
    this.showMassiveSearchModal = false;
    this.massiveSearchText = '';
    this.massiveSearchResults = null;
  }

  performMassiveSearch() {
    if (!this.massiveSearchText.trim()) {
      return;
    }

    this.massiveSearchLoading = true;

    // Extraer IMEIs usando múltiples patrones y mantener tanto el original como el limpio
    const allImeiData = [];

    // 1. Buscar números de exactamente 15 dígitos
    const imeiRegex15 = /\b\d{15}\b/g;
    let match15;
    while ((match15 = imeiRegex15.exec(this.massiveSearchText)) !== null) {
      allImeiData.push({
        clean: match15[0],
        original: match15[0]
      });
    }

    // 2. Buscar números de 16 dígitos
    const imeiRegex16 = /\b\d{16}\b/g;
    let match16;
    while ((match16 = imeiRegex16.exec(this.massiveSearchText)) !== null) {
      allImeiData.push({
        clean: match16[0].substring(0, 15),
        original: match16[0]
      });
    }

    // 3. Buscar patrones como "IMEI:123456789012345" o "IMEI 123456789012345"
    const imeiWithPrefixRegex = /(?:IMEI\s*:?\s*)(\d{15,16})/gi;
    let match;
    while ((match = imeiWithPrefixRegex.exec(this.massiveSearchText)) !== null) {
      allImeiData.push({
        clean: match[1].substring(0, 15),
        original: match[0]
      });
    }

    // 4. Buscar patrones como "IMEI865991076768229" (IMEI pegado sin separación)
    const imeiDirectRegex = /IMEI(\d{15,16})/gi;
    let directMatch;
    while ((directMatch = imeiDirectRegex.exec(this.massiveSearchText)) !== null) {
      allImeiData.push({
        clean: directMatch[1].substring(0, 15),
        original: directMatch[0]
      });
    }

    // Eliminar duplicados basado en el IMEI limpio
    const uniqueImeis = new Map();
    allImeiData.forEach(item => {
      if (!uniqueImeis.has(item.clean)) {
        uniqueImeis.set(item.clean, item);
      }
    });

    const imeiDataArray = Array.from(uniqueImeis.values());

    const foundImeis: any[] = [];
    const notFoundImeis: string[] = [];
    const matchingInvoices: any[] = [];

    // Buscar cada IMEI en todas las facturas
    imeiDataArray.forEach(imeiData => {
      let found = false;

      for (const invoice of this.allInvoices) {
        let hasImei = false;
        let itemName = '';

        // Crear múltiples patrones de búsqueda para el IMEI
        const searchPatterns = [
          imeiData.clean,           // IMEI limpio: 865991076768229
          imeiData.original,        // Formato original: IMEI865991076768229
          `IMEI${imeiData.clean}`,  // Con prefijo IMEI
          `IMEI:${imeiData.clean}`, // Con prefijo IMEI:
          `IMEI ${imeiData.clean}`  // Con prefijo IMEI (espacio)
        ];

        // Buscar con todos los patrones
        for (const pattern of searchPatterns) {
          const patternLower = pattern.toLowerCase();
          const regex = new RegExp('\\b' + patternLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');

          // Buscar en anotaciones de la factura
          const anotation = invoice.anotation?.toLowerCase() || '';
          hasImei = regex.test(anotation) || anotation.includes(patternLower);

          // Si lo encuentra en anotaciones y es una venta, tomar el primer item
          if (hasImei && this.selectedInvoiceType === 'sales') {
            if (invoice.items && invoice.items.length > 0) {
              itemName = invoice.items[0].name || '';
            }
            break;
          }

          if (!hasImei) {
            if (this.selectedInvoiceType === 'sales') {
              // Buscar en items de ventas
              const foundItem = invoice.items?.find((item: any) => {
                const description = item.description?.toLowerCase() || '';
                const observations = item.observations?.toLowerCase() || '';

                return regex.test(description) || regex.test(observations) ||
                  description.includes(patternLower) || observations.includes(patternLower);
              });

              if (foundItem) {
                hasImei = true;
                itemName = foundItem.name || '';
                break;
              }
            } else {
              // Buscar en items de compras
              hasImei = invoice.purchases?.items?.some((item: any) => {
                const description = item.description?.toLowerCase() || '';
                const observations = item.observations?.toLowerCase() || '';

                return regex.test(description) || regex.test(observations) ||
                  description.includes(patternLower) || observations.includes(patternLower);
              });

              if (hasImei) break;
            }
          }
        }

        if (hasImei) {
          found = true;
          const invoiceId = invoice.numberTemplate?.number || invoice.id;

          // Agregar IMEI con su ID de factura y nombre del item (solo para sales)
          const result: any = {
            imei: imeiData.clean,
            invoiceId: invoiceId
          };

          if (this.selectedInvoiceType === 'sales' && itemName) {
            result.itemName = itemName;
          }

          // Agregar tienda cuando selectedStore === 'todas'
          if (this.selectedStore === 'todas' && invoice.tienda) {
            result.storeName = invoice.tienda;
          }

          foundImeis.push(result);

          if (!matchingInvoices.find(inv => inv.id === invoice.id)) {
            matchingInvoices.push(invoice);
          }
        }
      }

      if (!found) {
        notFoundImeis.push(imeiData.clean);
      }
    });

    this.massiveSearchResults = {
      totalSearched: imeiDataArray.length,
      found: foundImeis,
      notFound: notFoundImeis,
      matchingInvoices: matchingInvoices
    };

    // Detectar IMEIs duplicados (que aparecen en múltiples facturas)
    const imeiCounts = new Map<string, number>();
    foundImeis.forEach(result => {
      const count = imeiCounts.get(result.imei) || 0;
      imeiCounts.set(result.imei, count + 1);
    });

    // Marcar los IMEIs que aparecen más de una vez como duplicados
    foundImeis.forEach(result => {
      result.isDuplicate = (imeiCounts.get(result.imei) || 0) > 1;
    });

    this.massiveSearchLoading = false;
  }

  applyMassiveSearchFilter() {
    if (this.massiveSearchResults && this.massiveSearchResults.matchingInvoices) {
      this.invoices = this.massiveSearchResults.matchingInvoices.slice(0, this.rows);
      this.totalRecords = this.massiveSearchResults.matchingInvoices.length;
      this.page = 0;
      this.closeMassiveSearchModal();
    }
  }

  clearMassiveSearchFilter() {
    this.filterInvoicesLocal();
    this.closeMassiveSearchModal();
  }

  isNewInvoice(invoiceId: string): boolean {
    return this.newInvoiceIds.includes(invoiceId);
  }

  isDeletedInvoice(invoiceId: string): boolean {
    return this.deletedInvoiceIds.includes(invoiceId);
  }

  getStatusText(status: string): string {
    const statusMap: { [key: string]: string } = {
      'draft': 'Borrador',
      'closed': 'Cobrada',
      'open': 'Por cobrar',
      'void': 'Anulada'
    };
    return statusMap[status] || status;
  }

  getStatusColor(status: string): { bg: string, text: string } {
    const colorMap: { [key: string]: { bg: string, text: string } } = {
      'void': { bg: 'rgb(241, 245, 249)', text: 'rgb(128, 141, 160)' },      // Anulada
      'draft': { bg: 'rgb(224, 231, 255)', text: 'rgb(67, 56, 202)' },       // Borrador
      'closed': { bg: 'rgb(220, 252, 231)', text: 'rgb(21, 128, 61)' },      // Cobrada
      'open': { bg: 'rgb(254, 243, 199)', text: 'rgb(180, 83, 9)' }          // Por cobrar
    };
    return colorMap[status] || { bg: 'rgb(241, 245, 249)', text: 'rgb(128, 141, 160)' };
  }

  // =========================================
  // Métodos para Exportación de Datos
  // =========================================

  openExportModal() {
    // Configurar fechas predeterminadas (último mes)
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setMonth(today.getMonth() - 1);

    this.exportEndDate = this.formatDateForInput(today);
    this.exportStartDate = this.formatDateForInput(lastMonth);
    this.showExportModal = true;
  }

  closeExportModal() {
    this.showExportModal = false;
    this.exportStartDate = '';
    this.exportEndDate = '';
    this.exportLoading = false;
  }

  formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  performExport() {
    if (!this.exportStartDate || !this.exportEndDate) {
      alert('Por favor selecciona un rango de fechas válido');
      return;
    }

    const startDate = new Date(this.exportStartDate);
    const endDate = new Date(this.exportEndDate);

    if (startDate > endDate) {
      alert('La fecha de inicio debe ser anterior a la fecha de fin');
      return;
    }

    this.exportLoading = true;

    if (this.selectedInvoiceType === 'sales') {
      // Buscar compras en TODAS las tiendas para encontrar el costo, sin importar dónde se compró
      this.invoiceService.getAllPurchaseInvoices('todas').subscribe({
        next: (res) => {
          this.purchaseInvoicesCache = res.data || [];
          this.continueExport(startDate, endDate);
        },
        error: (error) => {
          console.error('Error cargando facturas de compra:', error);
          this.purchaseInvoicesCache = [];
          this.continueExport(startDate, endDate);
        }
      });
    } else {
      this.continueExport(startDate, endDate);
    }
  }
  private continueExport(startDate: Date, endDate: Date) {
    // Filtrar facturas por rango de fechas
    let filteredInvoices = this.allInvoices.filter(invoice => {
      const invoiceDate = new Date(invoice.date);
      return invoiceDate >= startDate && invoiceDate <= endDate;
    });

    // Calcular el número máximo de bancos distintos usados en una sola factura dentro de esta selección
    let maxBanks = 1;
    filteredInvoices.forEach(inv => {
      let uniqueBanksCount = 0;
      if (inv.paymentBankAccounts && inv.paymentBankAccounts.length > 0) {
        const uniqueBanks = new Set(inv.paymentBankAccounts.map((pb: any) => pb.bankName || 'Desconocido'));
        uniqueBanksCount = uniqueBanks.size;
      } else if (inv.payments && inv.payments.length > 0) {
        uniqueBanksCount = 1; // Fallback counts as 1 bank
      }
      if (uniqueBanksCount > maxBanks) {
        maxBanks = uniqueBanksCount;
      }
    });

    // Exportar en formato Excel
    this.exportToExcel(filteredInvoices, maxBanks);

    this.exportLoading = false;
    this.closeExportModal();
  }

  exportToExcel(data: any[], maxBanks: number) {
    // Preparar datos para exportación
    const exportData = this.prepareExportData(data, maxBanks);

    // Crear hoja de trabajo
    const worksheet = XLSX.utils.json_to_sheet(exportData);

    // Aplicar filtros automáticos a los encabezados
    const range = XLSX.utils.decode_range(worksheet['!ref']!);
    worksheet['!autofilter'] = { ref: XLSX.utils.encode_range(range) };

    // Ajustar ancho de columnas dinámicamente según el tipo de factura
    if (this.selectedInvoiceType === 'purchases') {
      const colWidths = [
        { wch: 12 },  // Fecha
        { wch: 15 },  // Número Factura
        { wch: 30 },  // Proveedor
        { wch: 40 },  // Item
        { wch: 10 },  // Cantidad
        { wch: 50 },  // Descripción Item
        { wch: 30 },  // Anotación
        { wch: 25 }   // Consecutivo interno (ALEGRA)
      ];
      worksheet['!cols'] = colWidths;
    } else {
      // Para facturas de venta con formato de filas
      const colWidths: any[] = [
        { wch: 12 },  // Fecha
        { wch: 15 },  // Número Factura
        { wch: 15 },  // Tienda Original
        { wch: 15 },  // Bodega
        { wch: 20 },  // Centro de Costo
        { wch: 30 },  // Cliente
        { wch: 18 },  // Identificación Cliente
        { wch: 30 },  // Correo Cliente
        { wch: 20 },  // Teléfono Cliente
        { wch: 40 },  // Dirección Cliente
        { wch: 40 },  // Item
        { wch: 10 },  // Cantidad
        { wch: 15 },  // Precio Und
        { wch: 15 },  // Costo Und
        { wch: 50 },  // Descripción Item
        { wch: 30 },  // Anotación
      ];

      for (let i = 1; i <= maxBanks; i++) {
        colWidths.push({ wch: 20 }); // Banco X
        colWidths.push({ wch: 15 }); // Monto Banco X
      }

      colWidths.push(
        { wch: 20 },  // Vendedor
        { wch: 12 },  // Estado
        { wch: 15 },  // Impuesto
        { wch: 15 },  // Total
        { wch: 25 },  // Consecutivo interno (ALEGRA)
      );

      worksheet['!cols'] = colWidths;
    }

    // Crear libro de trabajo
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Facturas');

    // Generar nombre de archivo
    const fileName = `facturas_${this.selectedStore}_${this.selectedInvoiceType}_${this.exportStartDate}_${this.exportEndDate}.xlsx`;

    // Descargar archivo Excel
    XLSX.writeFile(workbook, fileName);
  }

  prepareExportData(invoices: any[], maxBanks: number): any[] {


    // Función para extraer IMEIs/seriales de un texto
    const extractIdentifiers = (text: string): string[] => {
      if (!text) return [];

      const identifiers: string[] = [];
      const cleanText = text.toUpperCase();

      // 1. Buscar IMEIs de 15 o 16 dígitos
      const imeiRegex = /\b\d{15,16}\b/g;
      let match;
      while ((match = imeiRegex.exec(cleanText)) !== null) {
        identifiers.push(match[0].substring(0, 15));
      }

      // 2. Buscar patrones con prefijos comunes (IMEI, Serial, S/N, etc.)
      // Permite letras, números, guiones y puntos en el identificador
      const prefixedRegex = /(?:IMEI|CELULAR|EQUIPO|S\/N|SN|SERIAL|SERIE|SL|S\.N|S\/L)\s*:?\s*([A-Z0-9\.\-_]{6,30})/gi;
      while ((match = prefixedRegex.exec(cleanText)) !== null) {
        const id = match[1].trim();
        if (id) identifiers.push(id.toUpperCase());
      }

      // 3. Buscar seriales alfanuméricos sospechosos (8+ caracteres con letras y números)
      const genericSerialRegex = /\b([A-Z0-9\-_]{8,25})\b/gi;
      while ((match = genericSerialRegex.exec(cleanText)) !== null) {
        const serial = match[1].toUpperCase();
        // Evitar falsos positivos: debe tener letras Y números, o ser muy largo
        const hasLetter = /[A-Z]/.test(serial);
        const hasNumber = /[0-9]/.test(serial);
        if ((hasLetter && hasNumber) || serial.length > 14) {
          identifiers.push(serial);
        }
      }

      return [...new Set(identifiers)]; // Eliminar duplicados
    };

    // Función para buscar el costo de un identificador en facturas de compra
    const findCostInPurchases = (identifier: string): number => {
      if (this.selectedInvoiceType === 'purchases' || !identifier) return 0;
      if (!this.purchaseInvoicesCache || this.purchaseInvoicesCache.length === 0) return 0;

      const idUpper = identifier.toUpperCase();

      for (const purchase of this.purchaseInvoicesCache) {
        // Soporte para múltiples estructuras de items de compra
        const rawItems = purchase.purchases?.items || purchase.items || [];
        
        for (const item of rawItems) {
          const name = (item.name || '').toUpperCase();
          const description = (item.description || '').toUpperCase();
          const observations = (item.observations || '').toUpperCase();
          const anotation = (purchase.anotation || '').toUpperCase();

          // Buscar coincidencia exacta o por subcadena del identificador
          if (description.includes(idUpper) || 
              observations.includes(idUpper) || 
              anotation.includes(idUpper) ||
              name.includes(idUpper)) {
            
            // Retornar el precio de compra del item
            return item.price || 0;
          }
        }
      }
      return 0;
    };

    if (this.selectedInvoiceType === 'sales') {
      // Datos completos para facturas de venta - FORMATO CON UNA FILA POR ITEM
      const exportRows: any[] = [];

      invoices.forEach(inv => {
        const items = inv.items || [];

        // Map Store identifiers
        const storeKey = inv.storeKey || this.selectedStore;
        let bodega = '';
        let centroCosto = '';
        switch (storeKey?.toLowerCase()) {
          case 'pasto': bodega = 'PASTO'; centroCosto = 'PRINCIPAL PASTO'; break;
          case 'medellin': bodega = 'MEDELLIN'; centroCosto = 'SEDE MEDELLIN'; break;
          case 'pereira': bodega = 'PEREIRA'; centroCosto = 'SEDE PEREIRA'; break;
          case 'armenia': bodega = 'ARMENIA'; centroCosto = 'SEDE ARMENIA'; break;
          case 'bogota': bodega = 'BOGOTA'; centroCosto = 'SEDE BOGOTA'; break;
        }

        const tiendaOriginal = inv.tienda || storeKey?.toUpperCase() || '';

        // Extract Banks from our structured backend payload (Aggregating identical banks)
        const bankInfo: any = {};
        if (inv.paymentBankAccounts && inv.paymentBankAccounts.length > 0) {
          const aggregatedBanks = new Map<string, number>();
          inv.paymentBankAccounts.forEach((pb: any) => {
            const name = pb.bankName || 'Desconocido';
            const amount = pb.amount || 0;
            aggregatedBanks.set(name, (aggregatedBanks.get(name) || 0) + amount);
          });

          let index = 0;
          aggregatedBanks.forEach((amount, bankName) => {
            if (index < maxBanks) {
              bankInfo[`Banco ${index + 1}`] = bankName;
              bankInfo[`Monto Banco ${index + 1}`] = amount;
              index++;
            }
          });
        } else if (inv.payments && inv.payments.length > 0) {
          // Fallback if structured 'paymentBankAccounts' is not available
          const mainBank = inv.payments[0]?.bankAccount || 'ADDI MARKETPLACE';
          bankInfo['Banco 1'] = mainBank;
          bankInfo['Monto Banco 1'] = inv.total;
        }

        const createRow = (item: any | null, isFirstRow: boolean) => {
          let cost = 0;

          if (item) {
            const identifiers = [
              ...extractIdentifiers(item.description || ''),
              ...extractIdentifiers(inv.anotation || '')
            ];

            // Intentar con cada identificador encontrado hasta que uno devuelva un costo distinto de 0
            for (const id of identifiers) {
              const foundCost = findCostInPurchases(id);
              if (foundCost > 0) {
                cost = foundCost;
                break;
              }
            }
          }
          const row: any = {
            'Fecha': inv.date,
            'Número Factura': inv.numberTemplate?.number || '',
            'Consecutivo interno (ALEGRA)': inv.id,
            'Tienda Original': isFirstRow ? tiendaOriginal : '',
            'Bodega': isFirstRow ? bodega : '',
            'Centro de Costo': isFirstRow ? centroCosto : '',
            'Cliente': inv.client?.name || '',
            'Identificación Cliente': inv.client?.identification || '',
            'Correo Cliente': inv.client?.email || '',
            'Teléfono Cliente': inv.client?.mobile || inv.client?.phonePrimary || inv.client?.phone1 || '',
            'Dirección Cliente': inv.client?.address?.address || (typeof inv.client?.address === 'string' ? inv.client.address : ''),
            'Ciudad Cliente': inv.client?.address?.city || '',
            'Departamento Cliente': inv.client?.address?.department || '',
            'Item': item ? item.name : '',
            'Cantidad': item ? item.quantity : '',
            'Precio Und': item ? item.price : '',
            'Costo Und': item ? cost : '',
            'Descripción Item': item ? item.description : '',
            'Anotación': inv.anotation || '',
          };

          for (let i = 1; i <= maxBanks; i++) {
            row[`Banco ${i}`] = isFirstRow ? (bankInfo[`Banco ${i}`] || '') : '';
            row[`Monto Banco ${i}`] = isFirstRow ? (bankInfo[`Monto Banco ${i}`] || '') : '';
          }

          row['Vendedor'] = inv.seller?.name || 'N/A';
          row['Estado'] = this.getStatusText(inv.status);
          row['Impuesto'] = ''; // Columna vacía para uso futuro
          row['Total'] = inv.total || 0;
          row['Consecutivo interno (ALEGRA)'] = inv.id || '';

          return row;
        };

        if (items.length === 0) {
          exportRows.push(createRow(null, true));
        } else {
          items.forEach((item: any, index: number) => {
            exportRows.push(createRow(item, index === 0));
          });
        }
      });

      return exportRows;
    } else {
      // Datos completos para facturas de compra - NUEVO FORMATO CON UNA FILA POR ITEM
      const exportRows: any[] = [];

      invoices.forEach(inv => {
        const items = inv.purchases?.items || inv.items || [];

        // Si no hay items, crear una fila con los datos de la factura sin items
        if (items.length === 0) {
          exportRows.push({
            'Fecha': inv.date,
            'Número Factura': inv.numberTemplate?.number || '',
            'Proveedor': inv.provider?.name || '',
            'Item': '',
            'Cantidad': '',
            'Descripción Item': '',
            'Anotación': inv.anotation || '',
            'Consecutivo interno (ALEGRA)': inv.id || ''
          });
        } else {
          // Crear una fila por cada item
          items.forEach((item: any) => {
            exportRows.push({
              'Fecha': inv.date,
              'Número Factura': inv.numberTemplate?.number || '',
              'Proveedor': inv.provider?.name || '',
              'Item': item.name,
              'Cantidad': item.quantity,
              'Descripción Item': item.description,
              'Anotación': inv.anotation || '',
              'Consecutivo interno (ALEGRA)': inv.id || ''
            });
          });
        }
      });

      return exportRows;
    }
  }

  convertToCSV(data: any[]): string {
    if (data.length === 0) return '';

    // Obtener encabezados
    const headers = Object.keys(data[0]);

    // Crear filas
    const rows = data.map(row => {
      return headers.map(header => {
        const value = row[header];
        // Escapar comillas y valores con comas
        const stringValue = String(value || '');
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',');
    });

    // Combinar encabezados y filas
    return [headers.join(','), ...rows].join('\n');
  }

  downloadFile(blob: Blob, fileName: string) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  getSelectedStoreName(): string {
    return this.stores.find(s => s.value === this.selectedStore)?.label || 'No seleccionada';
  }

  getSelectedTypeName(): string {
    return this.invoiceTypes.find(t => t.value === this.selectedInvoiceType)?.label || 'No seleccionado';
  }
}
