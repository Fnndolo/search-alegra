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

  constructor(private invoiceService: InvoiceService) {}

  ngOnInit() {
    this.loading = true;
    this.invoiceService.getAllInvoices().subscribe((res) => {
      this.updating = res.updating;
      this.progress = res.progress;
      this.allInvoices = res.data;
      this.totalRecords = this.allInvoices.length;
      this.invoices = this.allInvoices.slice(0, this.rows);
      this.loading = false;
    });
  }

  onFilterChange() {
    this.page = 0;
    this.filterInvoicesLocal();
  }

  filterInvoicesLocal() {
    let filtered = this.allInvoices;
    if (this.filterValue && this.filterValue.trim() !== '') {
      const filterLower = this.filterValue.toLowerCase();
      filtered = this.allInvoices.filter(
        (inv) =>
          (inv.anotation &&
            inv.anotation.toLowerCase().includes(filterLower)) ||
          (inv.items &&
            inv.items.some(
              (item: any) =>
                item.description &&
                item.description.toLowerCase().includes(filterLower),
            )),
      );
    }
    this.totalRecords = filtered.length;
    this.invoices = filtered.slice(
      this.page * this.rows,
      (this.page + 1) * this.rows,
    );
  }

  refreshInvoices() {
    this.loading = true;
    this.invoiceService.updateInvoices().subscribe((res) => {
      this.updating = res.updating;
      this.progress = res.progress;
      this.allInvoices = res.data;
      this.totalRecords = this.allInvoices.length;
      this.invoices = this.allInvoices.slice(0, this.rows);
      this.loading = false;
    });
  }

  loadInvoicesLazy(event: any) {
    this.page = event.first / event.rows;
    this.rows = event.rows;
    this.filterInvoicesLocal();
  }

  goToAlegra(id: string) {
  window.open(`https://app.alegra.com/invoice/view/id/${id}`, '_blank');
}
}
