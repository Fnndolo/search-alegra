import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TableModule } from 'primeng/table';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { InventoryApiService } from '../services/inventory-api.service';

@Component({
  selector: 'app-inventory-by-store',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TableModule, DropdownModule, InputTextModule,
    InputNumberModule, ButtonModule, IconFieldModule, InputIconModule, TagModule, ToastModule,
  ],
  providers: [MessageService],
  templateUrl: './inventory-by-store.component.html',
})
export class InventoryByStoreComponent implements OnInit {
  sedes: any[] = [];
  categorias: any[] = [];
  categoriaOptions: any[] = [];

  selectedStoreId: string | null = null;
  selectedCategoriaId: string | null = null;
  searchValue = '';

  units: any[] = [];
  fungibles: any[] = [];
  loading = false;
  savingPrice: Record<string, boolean> = {};

  private searchSubject = new Subject<void>();

  constructor(
    private api: InventoryApiService,
    private messageService: MessageService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit() {
    // Deep-link from the products tab: ?storeId=...&search=...
    const qp = this.route.snapshot.queryParamMap;
    const storeId = qp.get('storeId');
    const search = qp.get('search');
    if (storeId) this.selectedStoreId = storeId;
    if (search) this.searchValue = search;

    this.loadSedes();
    this.loadCategorias();

    this.searchSubject.pipe(debounceTime(350), distinctUntilChanged())
      .subscribe(() => this.loadUnits());

    // When arriving via deep-link the store is already set — load now (loadSedes won't auto-select).
    if (this.selectedStoreId) this.loadUnits();
  }

  loadSedes() {
    this.api.getSedes().subscribe({
      next: (data: any[]) => {
        this.sedes = data.map((s) => ({ ...s, nombre: s.name }));
        if (this.sedes.length && !this.selectedStoreId) {
          this.selectedStoreId = this.sedes[0].id;
          this.loadUnits();
        }
      },
      error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar las sedes' }),
    });
  }

  loadCategorias() {
    this.api.getCategorias().subscribe({
      next: (data: any[]) => {
        this.categorias = data;
        this.categoriaOptions = [{ id: null, name: 'Todas las categorías' }, ...data];
      },
      error: () => {},
    });
  }

  loadUnits() {
    if (!this.selectedStoreId) {
      this.units = [];
      this.fungibles = [];
      return;
    }
    const filters = {
      storeId: this.selectedStoreId,
      categoryId: this.selectedCategoriaId || undefined,
      search: this.searchValue.trim() || undefined,
    };
    this.loading = true;

    // Con variantes (per-unit) + sin variantes (fungible, by quantity) live in two shapes.
    let pending = 2;
    const done = () => { if (--pending === 0) this.loading = false; };

    this.api.getUnitsByStore(filters).subscribe({
      next: (data) => { this.units = data ?? []; done(); },
      error: () => {
        this.units = [];
        done();
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar las unidades' });
      },
    });

    this.api.getFungibleStockByStore(filters).subscribe({
      next: (data) => { this.fungibles = data ?? []; done(); },
      error: () => {
        this.fungibles = [];
        done();
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo cargar el stock de fungibles' });
      },
    });
  }

  saveVariantPrice(u: any) {
    this.savingPrice[u.id] = true;
    this.api.setVariantPrice(u.id, u.sale_price ?? null).subscribe({
      next: () => {
        this.savingPrice[u.id] = false;
        this.messageService.add({ severity: 'success', summary: 'Precio actualizado' });
      },
      error: () => {
        this.savingPrice[u.id] = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo guardar el precio' });
      },
    });
  }

  /** Fungible rows carry salePrice on the Product — it's the same across all its color variants. */
  saveProductPrice(row: any) {
    const id = row.product.id;
    this.savingPrice[id] = true;
    this.api.setProductPrice(id, row.product.sale_price ?? null).subscribe({
      next: () => {
        this.savingPrice[id] = false;
        this.messageService.add({ severity: 'success', summary: 'Precio actualizado' });
      },
      error: () => {
        this.savingPrice[id] = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo guardar el precio' });
      },
    });
  }

  onStoreChange() {
    this.loadUnits();
  }

  onCategoriaChange() {
    this.loadUnits();
  }

  onSearchChange() {
    this.searchSubject.next();
  }

  /** Clears category and search filters (keeps the store, required to query). */
  clearFilters() {
    this.selectedCategoriaId = null;
    this.searchValue = '';
    this.loadUnits();
  }

  get hasFilters(): boolean {
    return !!this.selectedCategoriaId || !!this.searchValue.trim();
  }
}
