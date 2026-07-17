import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';

import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { TagModule } from 'primeng/tag';
import { CardModule } from 'primeng/card';
import { DividerModule } from 'primeng/divider';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { AccordionModule } from 'primeng/accordion';

import { PurchaseOrdersService } from '../purchase-orders.service';

interface SyncLogEntry {
  order: {
    id: number;
    store: string;
    alegra_id: number;
    status: string;
    inventory_synced: boolean;
    date: string;
    total: number;
    provider: { name: string };
  };
  lastError: {
    action: string;
    detail: {
      success?: boolean;
      error?: string;
      stack?: string;
    } | null;
    created_at: string;
  } | null;
}

@Component({
  selector: 'app-sync-logs',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    ToastModule,
    TagModule,
    CardModule,
    DividerModule,
    ProgressSpinnerModule,
    AccordionModule,
  ],
  providers: [MessageService],
  templateUrl: './sync-logs.component.html',
})
export class SyncLogsComponent implements OnInit {
  loading = signal(true);
  entries: SyncLogEntry[] = [];
  retrying = signal<number | null>(null);

  constructor(
    private readonly service: PurchaseOrdersService,
    private readonly messageService: MessageService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.service.getSyncLogs().subscribe({
      next: (data: SyncLogEntry[]) => {
        this.entries = data;
        this.loading.set(false);
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'No se pudieron cargar los logs.',
        });
        this.loading.set(false);
      },
    });
  }

  retry(orderId: number): void {
    this.retrying.set(orderId);
    this.service.retryInventory(orderId).subscribe({
      next: (order) => {
        this.retrying.set(null);
        if (order.inventory_synced) {
          this.messageService.add({
            severity: 'success',
            summary: 'Inventario sincronizado',
            detail: `Orden ${orderId} sincronizada correctamente.`,
          });
          this.entries = this.entries.filter((e) => e.order.id !== orderId);
        } else {
          this.messageService.add({
            severity: 'warn',
            summary: 'Reintento completado con advertencias',
            detail: `Orden ${orderId}: revisá los detalles (posibles seriales duplicados).`,
            life: 8000,
          });
          this.load();
        }
      },
      error: (err) => {
        this.retrying.set(null);
        const detail = err.error?.message ?? 'Error al reintentar';
        this.messageService.add({ severity: 'error', summary: 'Error en reintento', detail, life: 10000 });
      },
    });
  }

  viewDetail(orderId: number): void {
    this.router.navigate(['/inventario/purchase-orders', orderId]);
  }

  errorMessage(entry: SyncLogEntry): string {
    return entry.lastError?.detail?.error ?? 'Sin detalle disponible';
  }

  errorStack(entry: SyncLogEntry): string {
    return entry.lastError?.detail?.stack ?? '';
  }

  failedAt(entry: SyncLogEntry): string {
    if (!entry.lastError?.created_at) return '—';
    return new Date(entry.lastError.created_at).toLocaleString('es-CO');
  }
}
