import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DocumentService, BillDetail, CompanyInfo } from '../../../core/http/document.service';
import { AuthService } from '../../../core/auth/auth.service';
import { MoneyPipe } from '../../../core/pipes/money.pipe';
import { ProfileMenuComponent } from '../../../layout/profile-menu/profile-menu.component';

@Component({
  selector: 'app-bill-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, ToastModule, MoneyPipe, ProfileMenuComponent],
  providers: [MessageService],
  templateUrl: './bill-detail.component.html',
  styleUrl: '../document-sheet.scss'
})
export class BillDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private documentService = inject(DocumentService);
  private messageService = inject(MessageService);
  private authService = inject(AuthService);

  store = '';
  billId = '';

  bill = signal<BillDetail | null>(null);
  company = signal<CompanyInfo | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  /** Solo admin y compras pueden editar facturas de compra */
  canEdit = computed(() => this.authService.hasRole(['admin', 'compras']));

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      this.store = params.get('store') || '';
      this.billId = params.get('id') || '';
      this.load();
    });
  }

  load() {
    this.loading.set(true);
    this.error.set(null);

    this.documentService.getBillDetail(this.store, this.billId).subscribe({
      next: (data) => {
        this.bill.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'No se pudo cargar la factura de compra.');
        this.loading.set(false);
      }
    });

    this.documentService.getBillCompany(this.store).subscribe({
      next: (data) => this.company.set(data),
      error: () => this.company.set(null)
    });
  }

  goBack() {
    this.router.navigate(['/facturas']);
  }

  goToEdit() {
    this.router.navigate(['/facturas/compra', this.store, this.billId, 'editar']);
  }

  print() {
    window.print();
  }

  openInAlegra() {
    window.open(`https://app.alegra.com/bill/view/id/${this.billId}`, '_blank');
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'closed': return 'Pagada';
      case 'open': return 'Por pagar';
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
}
