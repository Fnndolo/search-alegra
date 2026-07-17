import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PaginatorModule } from 'primeng/paginator';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputIconModule } from 'primeng/inputicon';
import { IconFieldModule } from 'primeng/iconfield';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { InventoryApiService } from '../services/inventory-api.service';

type Tab = 'todos' | 'clientes' | 'proveedores';

@Component({
  selector: 'app-contacts',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TableModule, PaginatorModule, DropdownModule, InputTextModule,
    InputIconModule, IconFieldModule, ButtonModule, DialogModule, TagModule, TooltipModule, ToastModule,
  ],
  providers: [MessageService],
  templateUrl: './contacts.component.html',
})
export class ContactsComponent implements OnInit {
  sedes: any[] = [];
  sedeOptions: any[] = [];
  selectedStoreId: string | null = null;
  searchValue = '';
  activeTab: Tab = 'todos';

  contacts: any[] = [];
  loading = false;
  syncing = false;

  // Pagination
  total = 0;
  page = 0;
  rows = 25;
  first = 0;

  showEditDialog = false;
  saving = false;
  editForm = {
    id: '', name: '', identification: '', email: '', phone: '', mobile: '',
    address: '', city: '', department: '', country: '', zipCode: '',
  };

  private searchSubject = new Subject<void>();

  constructor(
    private api: InventoryApiService,
    private messageService: MessageService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.loadSedes();
    this.searchSubject.pipe(debounceTime(350)).subscribe(() => this.reload());
    this.load();
  }

  loadSedes() {
    this.api.getSedes().subscribe({
      next: (data: any[]) => {
        this.sedes = data.map((s) => ({ ...s, nombre: s.name }));
        this.sedeOptions = [{ id: null, nombre: 'Todas las sedes' }, ...this.sedes];
        this.cdr.detectChanges();
      },
      error: () => {},
    });
  }

  private typeParam(): 'client' | 'provider' | undefined {
    if (this.activeTab === 'clientes') return 'client';
    if (this.activeTab === 'proveedores') return 'provider';
    return undefined;
  }

  load() {
    this.loading = true;
    this.api.getContactsForManage({
      storeId: this.selectedStoreId || undefined,
      type: this.typeParam(),
      search: this.searchValue.trim() || undefined,
      page: this.page,
      limit: this.rows,
    }).subscribe({
      next: (res) => {
        this.contacts = res?.data ?? [];
        this.total = res?.total ?? 0;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.contacts = [];
        this.total = 0;
        this.loading = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar los contactos' });
        this.cdr.detectChanges();
      },
    });
  }

  /** Resets to the first page and reloads (used when filters change). */
  private reload() {
    this.page = 0;
    this.first = 0;
    this.load();
  }

  onPageChange(e: any) {
    this.first = e.first;
    this.rows = e.rows;
    this.page = e.page;
    this.load();
  }

  setTab(tab: Tab) {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.reload();
  }

  onSearchChange() { this.searchSubject.next(); }
  onStoreChange() { this.reload(); }

  sync(full = false) {
    const sede = this.selectedStoreId ? this.sedes.find((s) => s.id === this.selectedStoreId) : null;
    this.syncing = true;
    if (full) {
      this.messageService.add({
        severity: 'info', summary: 'Sincronización completa iniciada',
        detail: 'Puede tardar varios minutos (trae TODOS los contactos de Alegra). El avance se ve en los logs del servidor.',
        life: 6000,
      });
    }
    const done = (detail: string) => {
      this.syncing = false;
      this.messageService.add({ severity: 'success', summary: 'Contactos sincronizados', detail });
      this.load();
    };
    const fail = () => {
      this.syncing = false;
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron sincronizar los contactos' });
      this.cdr.detectChanges();
    };

    if (sede) {
      this.api.syncContactsForStore(sede.store_key, full).subscribe({
        next: (r) => done(`${r.synced} contactos en ${sede.nombre}`),
        error: fail,
      });
    } else {
      this.api.syncAllContacts(full).subscribe({
        next: (r) => done(`${r.total} contactos en ${r.perStore.length} sede(s)`),
        error: fail,
      });
    }
  }

  openEdit(c: any) {
    const a = c.address ?? {};
    this.editForm = {
      id: c.id,
      name: c.name ?? '',
      identification: c.identification ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      mobile: c.mobile ?? '',
      address: a.address ?? '',
      city: a.city ?? '',
      department: a.department ?? '',
      country: a.country ?? '',
      zipCode: a.zipCode ?? '',
    };
    this.showEditDialog = true;
  }

  saveEdit() {
    if (!this.editForm.name.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Requerido', detail: 'El nombre es obligatorio' });
      return;
    }
    this.saving = true;
    this.api.updateContact(this.editForm.id, {
      name: this.editForm.name.trim(),
      identification: this.editForm.identification.trim() || undefined,
      email: this.editForm.email.trim() || undefined,
      phone: this.editForm.phone.trim() || undefined,
      mobile: this.editForm.mobile.trim() || undefined,
      address: {
        address: this.editForm.address.trim() || null,
        city: this.editForm.city.trim() || null,
        department: this.editForm.department.trim() || null,
        country: this.editForm.country.trim() || null,
        zipCode: this.editForm.zipCode.trim() || null,
      },
    }).subscribe({
      next: () => {
        this.saving = false;
        this.showEditDialog = false;
        this.messageService.add({ severity: 'success', summary: 'Contacto actualizado', detail: 'Cambios guardados en Alegra' });
        this.load();
      },
      error: (e) => {
        this.saving = false;
        this.messageService.add({ severity: 'error', summary: 'Error', detail: e?.error?.message || 'No se pudo actualizar el contacto', life: 6000 });
      },
    });
  }
}
