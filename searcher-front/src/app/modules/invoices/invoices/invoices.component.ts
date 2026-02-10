import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { PaginatorModule } from 'primeng/paginator';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { InvoiceService } from '../../../core/http/invoice.service';
import { SocketService } from '../../../core/services/socket.service';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { Subscription } from 'rxjs';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-invoices',
  standalone: true,
  imports: [
    CommonModule,
    TableModule,
    InputTextModule,
    PaginatorModule,
    FormsModule,
    HttpClientModule,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule
  ],
  providers: [InvoiceService, SocketService],
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

  // Propiedades para WebSocket
  private socketSubscriptions: Subscription[] = [];
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
    { label: 'Todas las tiendas', value: 'todas' }
  ];
  selectedStore = '';

  // Propiedades para búsqueda masiva
  showMassiveSearchModal = false;
  massiveSearchText = '';
  massiveSearchResults: any = null;
  massiveSearchLoading = false;

  // Propiedades para exportación de datos
  showExportModal = false;
  exportStartDate = '';
  exportEndDate = '';
  exportLoading = false;

  constructor(
    private invoiceService: InvoiceService,
    private socketService: SocketService,
    private cdr: ChangeDetectorRef
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
  }

  ngOnDestroy() {
    // Desconectar WebSocket y limpiar suscripciones
    this.disconnectWebSocket();
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
        next: (bill) => this.handleInvoiceCreated(bill)
      });

      const updatedSub = this.socketService.onBillUpdated().subscribe({
        next: (bill) => this.handleInvoiceUpdated(bill)
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

        // Aplicar filtro automáticamente si hay texto de búsqueda
        if (this.filterValue && this.filterValue.trim() !== '') {
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

        // Aplicar filtro automáticamente si hay texto de búsqueda
        if (this.filterValue && this.filterValue.trim() !== '') {
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

  onFilterChange() {
    this.page = 0;
    this.filterInvoicesLocal();
  }

  filterInvoicesLocal() {
    let filtered = this.allInvoices;
    // Usar trim() para ignorar espacios al inicio y final
    const trimmedFilter = this.filterValue?.trim() || '';

    if (trimmedFilter !== '') {
      const filterLower = trimmedFilter.toLowerCase();

      if (this.selectedInvoiceType === 'sales') {
        // Filtro para facturas de venta (ID, Cliente, Cédula, Tienda, Item, Anotación, Descripción, Vendedor)
        filtered = this.allInvoices.filter(
          (inv) =>
            // Buscar por ID
            (inv.numberTemplate?.number &&
              inv.numberTemplate.number.toString().toLowerCase().includes(filterLower)) ||
            // Buscar por Cliente
            (inv.client?.name &&
              inv.client.name.toLowerCase().includes(filterLower)) ||
            // Buscar por Cédula
            (inv.client?.identification &&
              inv.client.identification.toString().toLowerCase().includes(filterLower)) ||
            // Buscar por Tienda (solo cuando selectedStore === 'todas')
            (this.selectedStore === 'todas' && inv.tienda &&
              inv.tienda.toLowerCase().includes(filterLower)) ||
            // Buscar por Item (nombre)
            (inv.items &&
              inv.items.some(
                (item: any) =>
                  item.name &&
                  item.name.toLowerCase().includes(filterLower)
              )) ||
            // Buscar por Anotación
            (inv.anotation &&
              inv.anotation.toLowerCase().includes(filterLower)) ||
            // Buscar por Descripción de items
            (inv.items &&
              inv.items.some(
                (item: any) =>
                  item.description &&
                  item.description.toLowerCase().includes(filterLower)
              )) ||
            // Buscar por Vendedor
            (inv.seller?.name &&
              inv.seller.name.toLowerCase().includes(filterLower))
        );
      } else {
        // Filtro para facturas de compra (ID, Proveedor, Tienda, Items, Observaciones, Descripción)
        filtered = this.allInvoices.filter(
          (inv) =>
            // Buscar por ID
            (inv.numberTemplate?.number &&
              inv.numberTemplate.number.toString().toLowerCase().includes(filterLower)) ||
            // Buscar por Proveedor
            (inv.provider?.name &&
              inv.provider.name.toLowerCase().includes(filterLower)) ||
            // Buscar por Tienda (solo cuando selectedStore === 'todas')
            (this.selectedStore === 'todas' && inv.tienda &&
              inv.tienda.toLowerCase().includes(filterLower)) ||
            // Buscar por Items (nombre)
            (inv.purchases?.items &&
              inv.purchases.items.some(
                (item: any) =>
                  item.name &&
                  item.name.toLowerCase().includes(filterLower)
              )) ||
            // Buscar por Anotación
            (inv.anotation &&
              inv.anotation.toLowerCase().includes(filterLower)) ||
            // Buscar por Descripción de items
            (inv.purchases?.items &&
              inv.purchases.items.some(
                (item: any) =>
                  item.description &&
                  item.description.toLowerCase().includes(filterLower)
              ))
        );
      }
    }
    this.totalRecords = filtered.length;
    this.invoices = filtered.slice(
      this.page * this.rows,
      (this.page + 1) * this.rows,
    );
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
    if (this.massiveSearchResults?.matchingInvoices) {
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

    // Filtrar facturas por rango de fechas
    let filteredInvoices = this.allInvoices.filter(invoice => {
      const invoiceDate = new Date(invoice.date);
      return invoiceDate >= startDate && invoiceDate <= endDate;
    });

    // Si son facturas de venta, excluir las anuladas
    if (this.selectedInvoiceType === 'sales') {
      filteredInvoices = filteredInvoices.filter(invoice => invoice.status !== 'void');
    }

    if (filteredInvoices.length === 0) {
      alert('No se encontraron facturas en el rango de fechas seleccionado');
      this.exportLoading = false;
      return;
    }

    // Exportar en formato Excel
    this.exportToExcel(filteredInvoices);

    this.exportLoading = false;
    this.closeExportModal();
  }

  exportToExcel(data: any[]) {
    // Preparar datos para exportación
    const exportData = this.prepareExportData(data);

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
      // Para facturas de venta, ajustar automáticamente todas las columnas
      const colCount = Object.keys(exportData[0] || {}).length;
      worksheet['!cols'] = Array(colCount).fill({ wch: 15 });
    }

    // Crear libro de trabajo
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Facturas');

    // Generar nombre de archivo
    const fileName = `facturas_${this.selectedStore}_${this.selectedInvoiceType}_${this.exportStartDate}_${this.exportEndDate}.xlsx`;

    // Descargar archivo Excel
    XLSX.writeFile(workbook, fileName);
  }

  prepareExportData(invoices: any[]): any[] {
    // Función auxiliar para agrupar items por nombre
    const groupItems = (items: any[]) => {
      if (!items || items.length === 0) return [];

      const grouped = new Map<string, { name: string, quantity: number, price: number, description: string }>();

      items.forEach(item => {
        const name = item.name || '';
        if (grouped.has(name)) {
          const existing = grouped.get(name)!;
          existing.quantity += parseInt(item.quantity || 0);
        } else {
          grouped.set(name, {
            name: name,
            quantity: parseInt(item.quantity || 0),
            price: item.price || 0,
            description: item.description || ''
          });
        }
      });

      return Array.from(grouped.values());
    };

    if (this.selectedInvoiceType === 'sales') {
      // Encontrar el número máximo de items únicos en todas las facturas
      let maxItems = 0;
      invoices.forEach((inv: any) => {
        const groupedItems = groupItems(inv.items || []);
        if (groupedItems.length > maxItems) {
          maxItems = groupedItems.length;
        }
      });

      // Datos completos para facturas de venta (mantener formato original con columnas)
      return invoices.map(inv => {
        const row: any = {
          'Fecha': inv.date,
          'Número': inv.numberTemplate?.number || '',
          'Cliente': inv.client?.name || '',
          'Identificación Cliente': inv.client?.identification || '',
          'Teléfono Cliente': inv.client?.phonePrimary || inv.client?.phonePrimary || '',
          'Email Cliente': inv.client?.email || '',
          'Dirección Cliente': inv.client?.address?.address || '',
          'Ciudad Cliente': inv.client?.address?.city || ''
        };

        // Agrupar items y agregar columnas dinámicas
        const groupedItems = groupItems(inv.items || []);
        for (let i = 0; i < maxItems; i++) {
          const item = groupedItems[i];
          row[`Item ${i + 1}`] = item?.name || '';
          row[`Cantidad Item ${i + 1}`] = item?.quantity || '';
          row[`Precio Item ${i + 1}`] = item?.price || '';
        }

        // Agregar el resto de campos
        return {
          ...row,
          'Anotación': inv.anotation || '',
          'Descripción Items': inv.items?.map((i: any) => i.description).join(' | ') || '',
          'Método de Pago': inv.payments?.[0]?.bankAccount || 'ADDI MARKETPLACE',
          'Vendedor': inv.seller?.name || 'N/A',
          'Estado': this.getStatusText(inv.status),
          'Subtotal': inv.subtotal || 0,
          'Total': inv.total || 0,
          'Moneda': inv.currency?.code || 'COP',
          'Términos de Pago': inv.term || '',
          'Fecha Vencimiento': inv.dueDate || ''
        };
      });
    } else {
      // Datos completos para facturas de compra - NUEVO FORMATO CON UNA FILA POR ITEM
      const exportRows: any[] = [];

      invoices.forEach(inv => {
        const items = inv.purchases?.items || [];
        const groupedItems = groupItems(items);

        // Si no hay items, crear una fila con los datos de la factura sin items
        if (groupedItems.length === 0) {
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
          groupedItems.forEach(item => {
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
