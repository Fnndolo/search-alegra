import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DropdownModule } from 'primeng/dropdown';
import { DatePickerModule } from 'primeng/datepicker';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { DocumentService, BillDetail, CompanyInfo, BillUpdatePayload } from '../../../core/http/document.service';
import { MoneyPipe } from '../../../core/pipes/money.pipe';
import { ProfileMenuComponent } from '../../../layout/profile-menu/profile-menu.component';

interface EditableLine {
  itemId: number | string | null;
  name: string;
  price: number;
  discount: number;
  taxId: number | string | null;
  quantity: number;
  observations: string;
}

interface Option<T> {
  label: string;
  value: T;
}

@Component({
  selector: 'app-bill-edit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    DropdownModule,
    DatePickerModule,
    ToastModule,
    MoneyPipe,
    ProfileMenuComponent
  ],
  providers: [MessageService],
  templateUrl: './bill-edit.component.html',
  styleUrl: '../document-sheet.scss'
})
export class BillEditComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private documentService = inject(DocumentService);
  private messageService = inject(MessageService);

  store = '';
  billId = '';

  bill = signal<BillDetail | null>(null);
  company = signal<CompanyInfo | null>(null);
  loading = signal(true);
  saving = signal(false);
  error = signal<string | null>(null);

  // Formulario
  number: string | number = '';
  providerId: number | string | null = null;
  warehouseId: number | string | null = null;
  date: Date | null = null;
  dueDate: Date | null = null;
  observations = '';
  termsConditions = '';
  lines: EditableLine[] = [];

  // Valores originales: bodega y número solo se envían a Alegra si cambiaron,
  // para no reenviar campos que el usuario no tocó.
  private initialWarehouseId: number | string | null = null;
  private initialNumber: string = '';

  // Catálogos
  providers = signal<{ id: number | string; name: string; identification: string; phone: string }[]>([]);
  itemsCatalog = signal<{ id: number | string; name: string; reference: string; price: number }[]>([]);
  warehouses = signal<{ id: number | string; name: string }[]>([]);
  taxes = signal<{ id: number | string; name: string; percentage: number }[]>([]);

  providerOptions = computed<Option<number | string>[]>(() =>
    this.providers().map(p => ({ label: p.name, value: p.id }))
  );
  itemOptions = computed<Option<number | string>[]>(() =>
    this.itemsCatalog().map(i => ({ label: i.reference ? `${i.name} (${i.reference})` : i.name, value: i.id }))
  );
  warehouseOptions = computed<Option<number | string>[]>(() =>
    this.warehouses().map(w => ({ label: w.name, value: w.id }))
  );
  taxOptions = computed<Option<number | string | null>[]>(() => [
    { label: 'Ninguno', value: null },
    ...this.taxes().map(t => ({ label: `${t.name} (${t.percentage}%)`, value: t.id }))
  ]);

  // Modal de nuevo proveedor
  showProviderModal = signal(false);
  savingProvider = signal(false);
  newProvider = { name: '', identification: '', phone: '', email: '' };

  private itemSearch = new Subject<string>();
  private providerSearch = new Subject<string>();
  private subscriptions: Subscription[] = [];

  get selectedProvider() {
    return this.providers().find(p => `${p.id}` === `${this.providerId}`) || null;
  }

  ngOnInit() {
    this.subscriptions.push(
      this.itemSearch.pipe(debounceTime(350), distinctUntilChanged()).subscribe(query => this.loadItems(query)),
      this.providerSearch.pipe(debounceTime(350), distinctUntilChanged()).subscribe(query => this.loadProviders(query))
    );

    this.route.paramMap.subscribe(params => {
      this.store = params.get('store') || '';
      this.billId = params.get('id') || '';
      this.load();
    });
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  load() {
    this.loading.set(true);
    this.error.set(null);

    this.documentService.getBillDetail(this.store, this.billId).subscribe({
      next: (data) => {
        this.bill.set(data);
        this.hydrateForm(data);
        this.loading.set(false);
        this.loadCatalogs();
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

  private hydrateForm(doc: BillDetail) {
    this.number = doc.number ?? '';
    this.initialNumber = `${doc.number ?? ''}`;
    this.providerId = doc.provider.id;
    this.warehouseId = doc.warehouse?.id ?? null;
    this.initialWarehouseId = this.warehouseId;
    this.date = this.parseDate(doc.date);
    this.dueDate = this.parseDate(doc.dueDate);
    this.observations = doc.observations || '';
    this.termsConditions = doc.termsConditions || '';
    this.lines = doc.items.map(item => ({
      itemId: item.id,
      name: item.name,
      price: item.price,
      discount: item.discount,
      taxId: item.tax?.[0]?.id ?? null,
      quantity: item.quantity,
      observations: item.observations || item.description || ''
    }));

    // El proveedor y los ítems del documento deben existir en los desplegables
    // aunque no vengan en la primera página del catálogo.
    if (doc.provider.id) {
      this.providers.set([
        { id: doc.provider.id, name: doc.provider.name, identification: doc.provider.identification, phone: doc.provider.phone }
      ]);
    }
    this.itemsCatalog.set(
      doc.items.map(item => ({ id: item.id, name: item.name, reference: item.reference || '', price: item.price }))
    );
    if (doc.warehouse) {
      this.warehouses.set([{ id: doc.warehouse.id, name: doc.warehouse.name }]);
    }
    if (doc.items.some(item => item.tax?.length)) {
      const seeded = doc.items.flatMap(item => item.tax || []);
      this.taxes.set(seeded.map(t => ({ id: t.id, name: t.name, percentage: t.percentage })));
    }
  }

  private loadCatalogs() {
    this.loadProviders();
    this.loadItems();

    this.documentService.getWarehouses(this.store).subscribe({
      next: (data) => {
        if (data?.length) this.warehouses.set(this.mergeById(this.warehouses(), data));
      }
    });

    this.documentService.getTaxes(this.store).subscribe({
      next: (data) => {
        if (data?.length) this.taxes.set(this.mergeById(this.taxes(), data));
      }
    });
  }

  private loadProviders(query?: string) {
    this.documentService.getProviders(this.store, query).subscribe({
      next: (data) => {
        if (data?.length) this.providers.set(this.mergeById(this.providers(), data));
      }
    });
  }

  private loadItems(query?: string) {
    this.documentService.getItems(this.store, query).subscribe({
      next: (data) => {
        if (data?.length) this.itemsCatalog.set(this.mergeById(this.itemsCatalog(), data));
      }
    });
  }

  /** Conserva lo ya cargado (documento actual) y añade lo nuevo sin duplicar */
  private mergeById<T extends { id: number | string }>(current: T[], incoming: T[]): T[] {
    const byId = new Map<string, T>();
    [...current, ...incoming].forEach(entry => byId.set(`${entry.id}`, entry));
    return Array.from(byId.values());
  }

  private parseDate(value: string | null): Date | null {
    if (!value) return null;
    // Las fechas de Alegra son `yyyy-MM-dd`: se construyen en local para no
    // perder un día al interpretarlas como UTC.
    const [year, month, day] = value.split('T')[0].split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }

  private formatDate(value: Date | null): string | undefined {
    if (!value) return undefined;
    const year = value.getFullYear();
    const month = `${value.getMonth() + 1}`.padStart(2, '0');
    const day = `${value.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  onItemFilter(event: { filter: string }) {
    this.itemSearch.next(event?.filter || '');
  }

  onProviderFilter(event: { filter: string }) {
    this.providerSearch.next(event?.filter || '');
  }

  onItemSelected(line: EditableLine) {
    const item = this.itemsCatalog().find(i => `${i.id}` === `${line.itemId}`);
    if (!item) return;
    line.name = item.name;
    // Solo se sugiere el precio del catálogo si la línea aún no tiene uno propio
    if (!line.price) line.price = item.price;
  }

  addLine() {
    this.lines = [...this.lines, { itemId: null, name: '', price: 0, discount: 0, taxId: null, quantity: 1, observations: '' }];
  }

  removeLine(index: number) {
    this.lines = this.lines.filter((_, i) => i !== index);
  }

  lineTotal(line: EditableLine): number {
    const gross = (Number(line.price) || 0) * (Number(line.quantity) || 0);
    return gross - (gross * (Number(line.discount) || 0)) / 100;
  }

  get grossSubtotal(): number {
    return this.lines.reduce((acc, line) => acc + (Number(line.price) || 0) * (Number(line.quantity) || 0), 0);
  }

  get discountTotal(): number {
    return this.lines.reduce((acc, line) => {
      const gross = (Number(line.price) || 0) * (Number(line.quantity) || 0);
      return acc + (gross * (Number(line.discount) || 0)) / 100;
    }, 0);
  }

  get netSubtotal(): number {
    return this.grossSubtotal - this.discountTotal;
  }

  get taxTotal(): number {
    return this.lines.reduce((acc, line) => {
      const tax = this.taxes().find(t => `${t.id}` === `${line.taxId}`);
      if (!tax) return acc;
      return acc + (this.lineTotal(line) * (Number(tax.percentage) || 0)) / 100;
    }, 0);
  }

  get grandTotal(): number {
    return this.netSubtotal + this.taxTotal;
  }

  taxPercentage(line: EditableLine): number {
    const tax = this.taxes().find(t => `${t.id}` === `${line.taxId}`);
    return tax ? Number(tax.percentage) || 0 : 0;
  }

  // ─── Nuevo proveedor ──────────────────────────────────────────────────

  openProviderModal() {
    this.newProvider = { name: '', identification: '', phone: '', email: '' };
    this.showProviderModal.set(true);
  }

  closeProviderModal() {
    this.showProviderModal.set(false);
  }

  saveProvider() {
    if (!this.newProvider.name.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Falta el nombre', detail: 'Escriba el nombre del proveedor.' });
      return;
    }

    this.savingProvider.set(true);
    this.documentService.createProvider(this.store, this.newProvider).subscribe({
      next: (created) => {
        this.providers.set(this.mergeById(this.providers(), [created]));
        this.providerId = created.id;
        this.savingProvider.set(false);
        this.showProviderModal.set(false);
        this.messageService.add({ severity: 'success', summary: 'Proveedor creado', detail: created.name });
      },
      error: (err) => {
        this.savingProvider.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'No se pudo crear',
          detail: err?.error?.message || 'Alegra rechazó el nuevo proveedor.'
        });
      }
    });
  }

  // ─── Guardado ─────────────────────────────────────────────────────────

  private validate(): string | null {
    if (!this.providerId) return 'Seleccione el proveedor.';
    if (!this.date) return 'Indique la fecha de creación.';
    if (!this.dueDate) return 'Indique la fecha de vencimiento.';
    if (this.lines.length === 0) return 'La factura debe tener al menos una línea.';
    if (this.lines.some(line => !line.itemId)) return 'Todas las líneas deben tener un concepto seleccionado.';
    if (this.lines.some(line => (Number(line.quantity) || 0) <= 0)) return 'La cantidad de cada línea debe ser mayor que cero.';
    return null;
  }

  save() {
    const validationError = this.validate();
    if (validationError) {
      this.messageService.add({ severity: 'warn', summary: 'Revise el formulario', detail: validationError });
      return;
    }

    const payload: BillUpdatePayload = {
      date: this.formatDate(this.date),
      dueDate: this.formatDate(this.dueDate),
      provider: this.providerId!,
      observations: this.observations,
      termsConditions: this.termsConditions,
      items: this.lines.map(line => ({
        id: line.itemId!,
        price: Number(line.price) || 0,
        quantity: Number(line.quantity) || 1,
        discount: Number(line.discount) || 0,
        observations: line.observations || '',
        tax: line.taxId ? [{ id: line.taxId }] : []
      }))
    };

    if (this.warehouseId && `${this.warehouseId}` !== `${this.initialWarehouseId}`) {
      payload.warehouse = this.warehouseId;
    }
    const trimmedNumber = `${this.number}`.trim();
    if (trimmedNumber && trimmedNumber !== this.initialNumber) {
      payload.numberTemplate = { number: trimmedNumber };
    }

    this.saving.set(true);
    this.documentService.updateBill(this.store, this.billId, payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.messageService.add({ severity: 'success', summary: 'Guardado', detail: 'La factura de compra se actualizó en Alegra.' });
        this.router.navigate(['/facturas/compra', this.store, this.billId]);
      },
      error: (err) => {
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'No se pudo guardar',
          detail: err?.error?.message || 'Alegra rechazó los cambios.',
          life: 8000
        });
      }
    });
  }

  cancel() {
    this.router.navigate(['/facturas/compra', this.store, this.billId]);
  }
}
