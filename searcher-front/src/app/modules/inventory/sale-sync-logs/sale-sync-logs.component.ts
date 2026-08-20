import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MessageService } from 'primeng/api';

import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { TagModule } from 'primeng/tag';
import { CardModule } from 'primeng/card';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

import { SaleSyncLogsService, SaleSyncIssue, SaleSyncIssueReason } from './sale-sync-logs.service';

const REASON_LABELS: Record<SaleSyncIssueReason, string> = {
  NO_MAPPING: 'Sin mapeo a producto local',
  NO_IMEI_MATCH: 'IMEI no encontrado en stock',
  PARTIAL_MATCH: 'Coincidencia parcial de IMEIs',
  MULTI_VARIANT_FUNGIBLE: 'Producto con varias variantes (color)',
  NO_VARIANTS: 'Producto sin variantes',
};

@Component({
  selector: 'app-sale-sync-logs',
  standalone: true,
  imports: [CommonModule, ButtonModule, ToastModule, TagModule, CardModule, ProgressSpinnerModule],
  providers: [MessageService],
  templateUrl: './sale-sync-logs.component.html',
})
export class SaleSyncLogsComponent implements OnInit {
  loading = signal(true);
  issues: SaleSyncIssue[] = [];
  retrying = signal<string | null>(null);

  constructor(
    private readonly service: SaleSyncLogsService,
    private readonly messageService: MessageService,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.service.getSyncLogs().subscribe({
      next: (data) => {
        this.issues = data;
        this.loading.set(false);
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'No se pudieron cargar los logs de ventas.',
        });
        this.loading.set(false);
      },
    });
  }

  retry(issue: SaleSyncIssue): void {
    this.retrying.set(issue.id);
    this.service.retry(issue.alegra_invoice_id, issue.store_key).subscribe({
      next: (remaining) => {
        this.retrying.set(null);
        const stillFailing = remaining.some((r) => r.alegra_item_id === issue.alegra_item_id);
        if (!stillFailing) {
          this.messageService.add({
            severity: 'success',
            summary: 'Inventario descontado',
            detail: `Factura ${issue.alegra_invoice_id}: línea resuelta correctamente.`,
          });
        } else {
          this.messageService.add({
            severity: 'warn',
            summary: 'Sigue sin resolverse',
            detail: `Factura ${issue.alegra_invoice_id}: revisá el detalle nuevamente.`,
            life: 8000,
          });
        }
        this.load();
      },
      error: (err) => {
        this.retrying.set(null);
        const detail = err.error?.message ?? 'Error al reintentar';
        this.messageService.add({ severity: 'error', summary: 'Error en reintento', detail, life: 10000 });
      },
    });
  }

  reasonLabel(issue: SaleSyncIssue): string {
    return REASON_LABELS[issue.reason] ?? issue.reason;
  }

  createdAt(issue: SaleSyncIssue): string {
    return new Date(issue.created_at).toLocaleString('es-CO');
  }
}
