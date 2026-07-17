import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { InventoryLayoutComponent } from './inventory-layout/inventory-layout.component';
import { InventoryDashboardComponent } from './inventory-dashboard/inventory-dashboard.component';

const routes: Routes = [
  {
    path: '',
    component: InventoryLayoutComponent,
    children: [
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
      {
        path: 'overview',
        loadComponent: () =>
          import('./inventory-overview/inventory-overview.component').then(
            (m) => m.InventoryOverviewComponent
          ),
      },
      {
        path: 'existencias',
        loadComponent: () =>
          import('./inventory-by-store/inventory-by-store.component').then(
            (m) => m.InventoryByStoreComponent
          ),
      },
      {
        path: 'contactos',
        loadComponent: () =>
          import('./contacts/contacts.component').then((m) => m.ContactsComponent),
      },
      { path: 'productos', component: InventoryDashboardComponent },
      {
        path: 'productos/:id',
        loadComponent: () =>
          import('./inventory-dashboard/product-detail/product-detail.component').then(
            (m) => m.ProductDetailComponent,
          ),
      },
      { path: 'pendientes', component: InventoryDashboardComponent },
      { path: 'configuracion', component: InventoryDashboardComponent },
      { path: 'catalogos', component: InventoryDashboardComponent },
      {
        path: 'purchase-orders',
        loadComponent: () =>
          import('./purchase-orders/order-list/order-list.component').then(
            (m) => m.OrderListComponent,
          ),
      },
      {
        path: 'purchase-orders/new',
        loadComponent: () =>
          import('./purchase-orders/create-order/create-order.component').then(
            (m) => m.CreateOrderComponent,
          ),
      },
      {
        path: 'purchase-orders/sync-logs',
        loadComponent: () =>
          import('./purchase-orders/sync-logs/sync-logs.component').then(
            (m) => m.SyncLogsComponent,
          ),
      },
      {
        path: 'purchase-orders/:id/edit',
        loadComponent: () =>
          import('./purchase-orders/create-order/create-order.component').then(
            (m) => m.CreateOrderComponent,
          ),
      },
      {
        path: 'purchase-orders/:id',
        loadComponent: () =>
          import('./purchase-orders/order-detail/order-detail.component').then(
            (m) => m.OrderDetailComponent,
          ),
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class InventoryRoutingModule {}
