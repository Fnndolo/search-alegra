import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { CheckboxModule } from 'primeng/checkbox';
import { SelectButtonModule } from 'primeng/selectbutton';
import { MessageService } from 'primeng/api';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { InventoryApiService } from '../services/inventory-api.service';
// ProfileMenuComponent removed — now rendered in InventoryLayoutComponent
import { ProductFormModalComponent } from './product-form-modal/product-form-modal.component';
import { IngresoModalComponent } from './ingreso-modal/ingreso-modal.component';
import { ImeiSearchModalComponent } from './imei-search-modal/imei-search-modal.component';
import { CatalogoPanelComponent } from './catalogo-panel/catalogo-panel.component';
import { BodegaPanelComponent } from './bodega-panel/bodega-panel.component';
import { ImportDraftsPanelComponent } from './import-drafts-panel/import-drafts-panel.component';
import { ColorPanelComponent } from './color-panel/color-panel.component';

type Tab = 'productos' | 'configuracion' | 'catalogos';

@Component({
  selector: 'app-inventory-dashboard',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TableModule, ButtonModule,
    InputTextModule, DropdownModule, TagModule, ToastModule,
    TooltipModule, IconFieldModule, InputIconModule, CheckboxModule,
    SelectButtonModule, ProductFormModalComponent,
    IngresoModalComponent, ImeiSearchModalComponent,
    CatalogoPanelComponent, BodegaPanelComponent,
    ImportDraftsPanelComponent, ColorPanelComponent
  ],
  providers: [MessageService],
  templateUrl: './inventory-dashboard.component.html',
  styleUrl: './inventory-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InventoryDashboardComponent implements OnInit {
  activeTab: Tab = 'productos';

  // ── SHARED ───────────────────────────────────────────
  sedes: any[] = [];
  sedesOptions: any[] = [];

  // ── PRODUCTOS TAB ────────────────────────────────────
  productos: any[] = [];
  loadingProductos = true;
  selectedSedeFilter: string | null = null;
  searchValue = '';
  private searchSubject = new Subject<string>();
  totalProductos = 0;
  page = 0;
  rows = 20;
  expandedRows: { [key: string]: boolean } = {};

  showProductForm = false;
  showIngreso = false;
  selectedProducto: any = null;
  showImeiSearch = false;

  categorias: any[] = [];

  // ── CONFIGURACION TAB ────────────────────────────────
  syncConfig: any = null;
  loadingConfig = false;
  savingConfig = false;
  globalModeOptions = [
    { label: 'Auto', value: 'auto' },
    { label: 'Manual', value: 'manual' }
  ];
  sedeOverrides: { [sedeId: string]: 'auto' | 'manual' | null } = {};
  overrideOptions = [
    { label: 'Heredar global', value: null },
    { label: 'Auto', value: 'auto' },
    { label: 'Manual', value: 'manual' }
  ];

  constructor(
    private api: InventoryApiService,
    private messageService: MessageService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadSedes();
    this.loadCategorias();

    this.searchSubject.pipe(debounceTime(350), distinctUntilChanged())
      .subscribe(() => { this.page = 0; this.loadProductos(); });

    // Detect active tab from URL segment
    this.route.url.subscribe(segments => {
      const section = segments[0]?.path as Tab;
      if (section && ['productos', 'configuracion', 'catalogos'].includes(section)) {
        this.activateTab(section);
      } else {
        this.activateTab('productos');
      }
    });
  }

  loadCategorias() {
    this.api.getCategorias().subscribe({
      next: (data) => { this.categorias = data; },
      error: () => {}
    });
  }

  reloadCatalogs() {
    this.loadCategorias();
  }

  // ── SEDES ─────────────────────────────────────────────
  loadSedes() {
    this.api.getSedes().subscribe({
      next: (data) => {
        this.sedes = data.map((s: any) => ({ ...s, nombre: s.name }));
        this.sedesOptions = [...this.sedes];
        this.cdr.detectChanges();
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar las sedes' });
        this.cdr.detectChanges();
      }
    });
  }

  // ── PRODUCTOS ─────────────────────────────────────────
  loadProductos() {
    if (!this.selectedSedeFilter) {
      this.productos = [];
      this.totalProductos = 0;
      this.loadingProductos = false;
      this.cdr.detectChanges();
      return;
    }
    this.loadingProductos = true;
    this.api.getProductos({
      storeId: this.selectedSedeFilter,
      search: this.searchValue.trim() || undefined,
      page: this.page,
      limit: this.rows
    }).subscribe({
      next: (res) => {
        this.loadingProductos = false;
        this.productos = res.data;
        this.totalProductos = res.total;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadingProductos = false;
        this.productos = [];
        this.totalProductos = 0;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar los productos' });
        this.cdr.detectChanges();
      }
    });
  }

  onSedeFilterChange() {
    this.page = 0;
    this.loadProductos();
  }

  onSearchChange() {
    this.searchSubject.next(this.searchValue);
  }

  onPageChange(event: any) {
    this.page = event.first / event.rows;
    this.rows = event.rows;
    this.loadProductos();
  }

  toggleRow(producto: any) {
    if (this.expandedRows[producto.id]) {
      delete this.expandedRows[producto.id];
    } else {
      this.expandedRows[producto.id] = true;
      if (!producto._detalleLoaded) {
        this.loadProductoDetalle(producto);
      }
    }
    this.expandedRows = { ...this.expandedRows };
  }

  loadProductoDetalle(producto: any) {
    this.api.getProductoDetalle(producto.id).subscribe({
      next: (res) => {
        const idx = this.productos.findIndex(p => p.id === producto.id);
        if (idx !== -1) {
          this.productos[idx] = { ...this.productos[idx], ...res, _detalleLoaded: true };
          this.productos = [...this.productos];
        }
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo cargar el detalle del producto' });
      }
    });
  }

  openIngreso(producto: any) {
    this.selectedProducto = producto;
    this.showIngreso = true;
  }

  syncingContacts = false;
  contactsSyncResult = '';

  syncAllContacts() {
    this.syncingContacts = true;
    this.contactsSyncResult = '';
    this.api.syncAllContacts().subscribe({
      next: (r) => {
        this.syncingContacts = false;
        const errores = r.perStore.filter((s) => s.error).length;
        this.contactsSyncResult = `${r.total} contactos sincronizados en ${r.perStore.length} sede(s)` + (errores ? ` · ${errores} con error` : '');
        this.messageService.add({ severity: errores ? 'warn' : 'success', summary: 'Contactos sincronizados', detail: this.contactsSyncResult });
        this.cdr.markForCheck();
      },
      error: () => {
        this.syncingContacts = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron sincronizar los contactos' });
        this.cdr.markForCheck();
      },
    });
  }

  /** "Sin identificador" = stock fungible por cantidad. Depende directo del producto, no de la categoría. */
  esSinVariantes(producto: any): boolean {
    return producto?.hasIdentifier === false;
  }

  /** Navigate to the product detail ficha (variantes, stock por bodega, edición). */
  verDetalle(producto: any) {
    this.router.navigate(['/inventario/productos', producto.id]);
  }

  onIngresoSaved() {
    this.loadProductos();
  }

  // ── CONFIGURACION ─────────────────────────────────────
  loadSyncConfig() {
    this.loadingConfig = true;
    this.api.getSyncConfig().subscribe({
      next: (data) => {
        this.loadingConfig = false;
        this.syncConfig = data;
        this.sedeOverrides = {};
        if (data?.stores) {
          data.stores.forEach((s: any) => {
            this.sedeOverrides[s.id] = s.override ?? null;
          });
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.loadingConfig = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo cargar la configuración' });
        this.cdr.detectChanges();
      }
    });
  }

  saveConfig() {
    if (!this.syncConfig) return;
    this.savingConfig = true;
    const overrides = Object.entries(this.sedeOverrides).map(([storeId, mode]) => ({ storeId, mode }));
    this.api.updateSyncConfig({ globalMode: this.syncConfig.globalMode, storeOverrides: overrides }).subscribe({
      next: (data) => {
        this.savingConfig = false;
        this.syncConfig = data;
        this.messageService.add({ severity: 'success', summary: 'Configuración guardada' });
        this.cdr.detectChanges();
      },
      error: () => {
        this.savingConfig = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo guardar la configuración' });
        this.cdr.detectChanges();
      }
    });
  }

  // ── TAB SWITCHING ─────────────────────────────────────
  setTab(tab: Tab) {
    this.router.navigate(['/inventario', tab]);
  }

  private activateTab(tab: Tab) {
    this.activeTab = tab;
    if (tab === 'productos' && this.productos.length === 0 && this.selectedSedeFilter) {
      this.loadProductos();
    }
    if (tab === 'configuracion' && !this.syncConfig) {
      this.loadSyncConfig();
    }
  }
}
