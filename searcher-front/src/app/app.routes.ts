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
        path: 'inventario',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'inventario', 'usuario'] },
        loadChildren: () => import('./modules/inventory/inventory.module').then(m => m.InventoryModule)
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