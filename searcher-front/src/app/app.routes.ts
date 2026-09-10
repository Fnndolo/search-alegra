import { Routes } from '@angular/router';
import { MainLayoutComponent } from './layout/main-layout/main-layout.component';
import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';

export const routes: Routes = [
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        redirectTo: 'facturas',
        pathMatch: 'full'
      },
      {
        path: 'facturas/compra/:store/:id/editar',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'compras'] },
        loadComponent: () => import('./modules/documents/bill-edit/bill-edit.component').then(m => m.BillEditComponent)
      },
      {
        path: 'facturas/compra/:store/:id',
        loadComponent: () => import('./modules/documents/bill-detail/bill-detail.component').then(m => m.BillDetailComponent)
      },
      {
        path: 'facturas/venta/:store/:id',
        loadComponent: () => import('./modules/documents/invoice-detail/invoice-detail.component').then(m => m.InvoiceDetailComponent)
      },
      {
        path: 'facturas',
        loadComponent: () => import('./modules/invoices/invoices/invoices.component').then(m => m.InvoicesComponent)
      },
      {
        path: 'facturacion-electronica',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'facturacion'] },
        loadChildren: () => import('./modules/electronic-billing/electronic-billing.module').then(m => m.ElectronicBillingModule)
      },
      {
        path: 'usuarios',
        canActivate: [roleGuard],
        data: { roles: ['admin'] },
        loadComponent: () => import('./modules/users/user-management/user-management.component').then(m => m.UserManagementComponent)
      }
    ]
  },
  {
    path: 'login',
    loadComponent: () => import('./modules/auth/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: '**',
    redirectTo: 'facturas'
  }
];
