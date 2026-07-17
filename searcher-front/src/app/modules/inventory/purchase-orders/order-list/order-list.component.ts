import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';

import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { CalendarModule } from 'primeng/calendar';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

import { PurchaseOrdersService } from '../purchase-orders.service';
import { InventoryApiService } from '../../services/inventory-api.service';

@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TableModule,
    ButtonModule,
    DropdownModule,
    InputTextModule,
    CalendarModule,
    TagModule,
    ToastModule,
    ProgressSpinnerModule,
  ],
  providers: [MessageService],
  templateUrl: './order-list.component.html',
})
export class OrderListComponent implements OnInit {
  loading = signal(false);
  orders: any[] = [];
  total = 0;
  page = 1;
  limit = 20;

  filters = {
    store: '',
    status: '',
    dateFrom: '',
    dateTo: '',
    search: '',
  };

  storeOptions: { label: string; value: string }[] = [{ label: 'Todas', value: '' }];

  statusOptions = [
    { label: 'Todos', value: '' },
    { label: 'Borrador', value: 'draft' },
    { label: 'Activa', value: 'active' },
    { label: 'Serial duplicado', value: 'serial_duplicated' },
    { label: 'Anulada', value: 'cancelled' },
  ];

  constructor(
    private readonly service: PurchaseOrdersService,
    private readonly inventoryApi: InventoryApiService,
    private readonly router: Router,
    private readonly messageService: MessageService,
  ) {}

  ngOnInit(): void {
    this.loadStores();
    this.loadOrders();
  }

  private loadStores(): void {
    this.inventoryApi.getSedes().subscribe({
      next: (sedes: any[]) => {
        this.storeOptions = [
          { label: 'Todas', value: '' },
          ...sedes.map((s) => ({ label: s.name ?? s.nombre, value: s.store_key })),
        ];
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar las tiendas' });
      },
    });
  }

  loadOrders(): void {
    this.loading.set(true);
    this.service.findAll({ ...this.filters, page: this.page, limit: this.limit }).subscribe({
      next: (res) => {
        this.orders = res.data;
        this.total = res.total;
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  onPage(event: any): void {
    this.page = Math.floor(event.first / event.rows) + 1;
    this.limit = event.rows;
    this.loadOrders();
  }

  applyFilters(): void {
    this.page = 1;
    this.loadOrders();
  }

  clearFilters(): void {
    this.filters = { store: '', status: '', dateFrom: '', dateTo: '', search: '' };
    this.page = 1;
    this.loadOrders();
  }

  viewDetail(id: number): void {
    this.router.navigate(['/inventario/purchase-orders', id]);
  }

  editDraft(id: number): void {
    this.router.navigate(['/inventario/purchase-orders', id, 'edit']);
  }

  statusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    const map: Record<string, 'success' | 'warn' | 'danger' | 'info' | 'secondary'> = {
      active: 'success',
      serial_duplicated: 'warn',
      cancelled: 'danger',
      draft: 'secondary',
    };
    return map[status] ?? 'info';
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = {
      active: 'Activa',
      serial_duplicated: 'Serial duplicado',
      cancelled: 'Anulada',
      draft: 'Borrador',
    };
    return map[status] ?? status;
  }
}
