import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { ToastModule } from 'primeng/toast';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';
import { environment } from '../../../../environments/environment';
import { ProfileMenuComponent } from '../../../layout/profile-menu/profile-menu.component';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    ReactiveFormsModule, 
    TableModule, 
    ButtonModule, 
    DialogModule, 
    InputTextModule, 
    DropdownModule, 
    ToastModule,
    TagModule,
    ProfileMenuComponent
  ],
  providers: [MessageService],
  templateUrl: './user-management.component.html',
  styleUrl: './user-management.component.scss'
})
export class UserManagementComponent implements OnInit {
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);
  private messageService = inject(MessageService);
  private apiUrl = environment.API_URL;

  users = signal<any[]>([]);
  loading = signal(false);
  displayDialog = signal(false);
  isEdit = signal(false);
  selectedUserId = signal<number | null>(null);

  userForm = this.fb.group({
    username: ['', Validators.required],
    password: ['', []], // Solo requerido al crear
    email: ['', [Validators.email]],
    role: ['usuario', Validators.required],
    status: ['active', Validators.required]
  });

  roles = [
    { label: 'Administrador', value: 'admin' },
    { label: 'Usuario (Solo Buscador)', value: 'usuario' },
    { label: 'Facturación (Buscador + Export)', value: 'facturacion' }
  ];

  statuses = [
    { label: 'Activo', value: 'active' },
    { label: 'Inactivo', value: 'inactive' }
  ];

  ngOnInit() {
    this.loadUsers();
  }

  loadUsers() {
    this.loading.set(true);
    this.http.get<any[]>(`${this.apiUrl}/users`).subscribe({
      next: (data) => {
        this.users.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar los usuarios' });
        this.loading.set(false);
      }
    });
  }

  openNew() {
    this.isEdit.set(false);
    this.selectedUserId.set(null);
    this.userForm.reset({ role: 'usuario', status: 'active' });
    this.userForm.get('password')?.setValidators([Validators.required, Validators.minLength(6)]);
    this.displayDialog.set(true);
  }

  editUser(user: any) {
    this.isEdit.set(true);
    this.selectedUserId.set(user.id);
    this.userForm.patchValue({
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status
    });
    this.userForm.get('password')?.setValidators([Validators.minLength(6)]);
    this.displayDialog.set(true);
  }

  saveUser() {
    if (this.userForm.invalid) return;

    const data = { ...this.userForm.value };
    if (!data.password) delete data.password;

    const request = this.isEdit() 
      ? this.http.patch(`${this.apiUrl}/users/${this.selectedUserId()}`, data)
      : this.http.post(`${this.apiUrl}/users`, data);

    request.subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Éxito', detail: `Usuario ${this.isEdit() ? 'actualizado' : 'creado'} correctamente` });
        this.displayDialog.set(false);
        this.loadUsers();
      },
      error: (err) => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: err.error?.message || 'Error al guardar usuario' });
      }
    });
  }

  getRoleSeverity(role: string): 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast' {
    switch(role) {
      case 'admin': return 'danger';
      case 'facturacion': return 'info';
      default: return 'secondary';
    }
  }

  getStatusSeverity(status: string): 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast' {
    return status === 'active' ? 'success' : 'danger';
  }
}
