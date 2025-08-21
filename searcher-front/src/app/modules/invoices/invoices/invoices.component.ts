import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { PaginatorModule } from 'primeng/paginator';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { InvoiceService } from '../../../core/http/invoice.service';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';

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
  providers: [InvoiceService],
  templateUrl: './invoices.component.html',
  // styleUrls: ['./invoices.component.scss']
})
export class InvoicesComponent implements OnInit {
  invoices: any[] = [];
  allInvoices: any[] = [];
  totalRecords = 0;
  loading = false;
  updating = false;
  progress = 0;
  page = 0;
  rows = 30;
  filterValue = '';

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

  constructor(private invoiceService: InvoiceService) {
    console.log('Constructor - invoiceTypes:', this.invoiceTypes);
    console.log('Constructor - selectedInvoiceType:', this.selectedInvoiceType);
  }

  ngOnInit() {
    this.loadInvoices();
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
    this.page = 0;
    // NO borramos el filterValue para mantener la búsqueda
    this.allInvoices = [];
    this.invoices = [];
    this.totalRecords = 0;
    this.loadInvoices();
  }

  onStoreChange() {
    this.page = 0;
    // NO borramos el filterValue para mantener la búsqueda
    this.allInvoices = [];
    this.invoices = [];
    this.totalRecords = 0;
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
        // Filtro para facturas de venta (ID, Cliente, Item, Anotación, Descripción)
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
              ))
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
}
