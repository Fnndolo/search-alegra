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
}
