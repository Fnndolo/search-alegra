import { Component, signal, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { FormsModule } from '@angular/forms';
import { ElectronicBillingService } from '../services/electronic-billing.service';
import * as xlsx from 'xlsx';

@Component({
  selector: 'app-sync-logs',
  standalone: true,
  imports: [CommonModule, TableModule, TagModule, ButtonModule, FormsModule],
  templateUrl: './sync-logs.component.html',
  styleUrl: './sync-logs.component.scss'
})
export class SyncLogsComponent implements OnInit {

  logs = signal<any[]>([]);
  isLoading = signal<boolean>(true);
  private billingService = inject(ElectronicBillingService);

  // Pagination
  page = 0;
  rows = 25;

  jumpToPage(event: any) {
    const targetPage = parseInt(event.target.value, 10);
    const totalRecords = this.logs().length;
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
    return Math.ceil(this.logs().length / this.rows) || 1;
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

  ngOnInit() {
    this.fetchLogs();
  }

  fetchLogs() {
    this.isLoading.set(true);
    this.billingService.getSyncLogs().subscribe({
      next: (data) => {
        this.logs.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error fetching logs', err);
        this.isLoading.set(false);
      }
    });
  }

  exportErrors() {
    const errorLogs = this.logs().filter(log => log.status === 'FAILED');
    if (errorLogs.length === 0) {
      alert('No hay fallos de sincronización para exportar.');
      return;
    }

    const dataToExport = errorLogs.map(log => ({
      'Fecha': new Date(log.createdAt).toLocaleString(),
      'ID Original (Alegra)': log.originalInvoiceId,
      'Estado': log.status,
      'Razón del Error': log.errorMessage
    }));

    const worksheet = xlsx.utils.json_to_sheet(dataToExport);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Fallos_Sincronizacion');

    // Generar formato CSV
    xlsx.writeFile(workbook, `errores_facturacion_${new Date().toISOString().split('T')[0]}.csv`);
  }
}
