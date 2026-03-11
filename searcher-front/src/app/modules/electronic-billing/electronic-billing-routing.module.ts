import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'standardize-items',
    loadComponent: () => import('./standardize-items/standardize-items.component').then(m => m.StandardizeItemsComponent)
  },
  {
    path: 'standardize-banks',
    loadComponent: () => import('./standardize-banks/standardize-banks.component').then(m => m.StandardizeBanksComponent)
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ElectronicBillingRoutingModule { }
