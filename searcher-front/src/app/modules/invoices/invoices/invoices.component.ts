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
    { label: 'Smart Gadgets Pereira', value: 'pereira' }
  ];
  selectedStore = '';

  // Propiedades para búsqueda masiva
  showMassiveSearchModal = false;
  massiveSearchText = '';
  massiveSearchResults: any = null;
  massiveSearchLoading = false;

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

  handleInvoiceDeleted(invoiceId: string) {
    // Marcar como eliminada para animación ANTES de eliminar
    this.deletedInvoiceIds.push(invoiceId);

    // Forzar detección de cambios para mostrar animación
    this.cdr.detectChanges();

    // Esperar a que la animación se vea antes de eliminar
    setTimeout(() => {
      // Eliminar la factura del array
      this.allInvoices = this.allInvoices.filter(inv => inv.id !== invoiceId);
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
        // Filtro para facturas de venta (ID, Cliente, Item, Anotación, Descripción, Vendedor)
        filtered = this.allInvoices.filter(
          (inv) =>
            // Buscar por ID
            (inv.numberTemplate?.number &&
              inv.numberTemplate.number.toString().toLowerCase().includes(filterLower)) ||
            // Buscar por Cliente
            (inv.client?.name &&
              inv.client.name.toLowerCase().includes(filterLower)) ||
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
        // Filtro para facturas de compra (ID, Proveedor, Items, Observaciones, Descripción)
        filtered = this.allInvoices.filter(
          (inv) =>
            // Buscar por ID
            (inv.numberTemplate?.number &&
              inv.numberTemplate.number.toString().toLowerCase().includes(filterLower)) ||
            // Buscar por Proveedor
            (inv.provider?.name &&
              inv.provider.name.toLowerCase().includes(filterLower)) ||
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
}
