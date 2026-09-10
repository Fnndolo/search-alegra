import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DocumentService, InvoiceDetail, CompanyInfo } from '../../../core/http/document.service';
import { MoneyPipe } from '../../../core/pipes/money.pipe';
import { ProfileMenuComponent } from '../../../layout/profile-menu/profile-menu.component';

@Component({
  selector: 'app-invoice-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, ToastModule, MoneyPipe, ProfileMenuComponent],
  providers: [MessageService],
  templateUrl: './invoice-detail.component.html',
  styleUrl: '../document-sheet.scss'
})
export class InvoiceDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private documentService = inject(DocumentService);

  store = '';
  invoiceId = '';

  invoice = signal<InvoiceDetail | null>(null);
  company = signal<CompanyInfo | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      this.store = params.get('store') || '';
      this.invoiceId = params.get('id') || '';
      this.load();
    });
  }

  load() {
    this.loading.set(true);
    this.error.set(null);

    this.documentService.getInvoiceDetail(this.store, this.invoiceId).subscribe({
      next: (data) => {
        this.invoice.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'No se pudo cargar la factura de venta.');
        this.loading.set(false);
      }
    });

    this.documentService.getInvoiceCompany(this.store).subscribe({
      next: (data) => this.company.set(data),
      error: () => this.company.set(null)
    });
  }

  goBack() {
    this.router.navigate(['/facturas']);
  }

  print() {
    window.print();
  }

  openInAlegra() {
    window.open(`https://app.alegra.com/invoice/view/id/${this.invoiceId}`, '_blank');
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'closed': return 'Cobrada';
      case 'open': return 'Por cobrar';
      case 'draft': return 'Borrador';
      case 'void': return 'Anulada';
      default: return status || 'Sin estado';
    }
  }

  statusColor(status: string): string {
    switch (status) {
      case 'closed': return '#0d9488';
      case 'open': return '#e2562b';
      case 'draft': return '#64748b';
      case 'void': return '#0f172a';
      default: return '#64748b';
    }
  }

  paymentFormLabel(paymentForm: string): string {
    switch ((paymentForm || '').toUpperCase()) {
      case 'CASH': return 'De contado';
      case 'CREDIT': return 'A crédito';
      default: return paymentForm || '--';
    }
  }

  paymentStatusLabel(status: string): string {
    switch ((status || '').toLowerCase()) {
      case 'open': return 'Abierto';
      case 'closed': return 'Cerrado';
      case 'void': return 'Anulado';
      default: return status || '--';
    }
  }
}
