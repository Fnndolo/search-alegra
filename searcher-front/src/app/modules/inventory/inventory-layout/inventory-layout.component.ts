import { Component, ChangeDetectionStrategy, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { ProfileMenuComponent } from '../../../layout/profile-menu/profile-menu.component';
import { SaleSyncLogsService } from '../sale-sync-logs/sale-sync-logs.service';

@Component({
  selector: 'app-inventory-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, ProfileMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col bg-surface-50 min-h-full w-full">

      <!-- Sticky Page Header -->
      <header class="h-16 bg-white border-b border-surface-200 flex items-center justify-between px-6 shrink-0 shadow-sm sticky top-0 z-30">
        <div>
          <h1 class="text-lg font-bold text-surface-900 leading-none">Inventario</h1>
          <p class="text-surface-400 text-xs mt-0.5">Gestión de productos y stock</p>
        </div>
        <app-profile-menu class="hidden md:block"></app-profile-menu>
      </header>

      <!-- Sub-nav tab bar — hidden on purchase-orders routes -->
      <div *ngIf="showTabBar()" class="bg-white border-b border-surface-200 px-3 md:px-6 shrink-0">
        <div class="flex gap-1 md:gap-2 overflow-x-auto select-none -mb-px">

          <a routerLink="/inventario/overview"
             routerLinkActive="text-primary-600 border-b-[3px] border-primary-500"
             [routerLinkActiveOptions]="{ exact: true }"
             class="px-5 py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap text-surface-500 hover:text-surface-800 hover:bg-surface-50 rounded-t-lg flex items-center gap-2">
            <i class="pi pi-chart-bar text-lg"></i>
            <span>Panel General</span>
          </a>

          <a routerLink="/inventario/existencias"
             routerLinkActive="text-primary-600 border-b-[3px] border-primary-500"
             class="px-5 py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap text-surface-500 hover:text-surface-800 hover:bg-surface-50 rounded-t-lg flex items-center gap-2">
            <i class="pi pi-warehouse text-lg"></i>
            <span>Inventario por sede</span>
          </a>

          <a routerLink="/inventario/productos"
             routerLinkActive="text-primary-600 border-b-[3px] border-primary-500"
             class="px-5 py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap text-surface-500 hover:text-surface-800 hover:bg-surface-50 rounded-t-lg flex items-center gap-2">
            <i class="pi pi-box text-lg"></i>
            <span>Productos</span>
          </a>

          <a routerLink="/inventario/pendientes"
             routerLinkActive="text-primary-600 border-b-[3px] border-primary-500"
             class="px-5 py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap text-surface-500 hover:text-surface-800 hover:bg-surface-50 rounded-t-lg flex items-center gap-2">
            <i class="pi pi-sync text-lg"></i>
            <span>Pendientes</span>
            <span *ngIf="pendientesCount() > 0"
                  class="px-1.5 py-0.5 text-xs font-bold rounded-full bg-amber-500 text-white">
              {{ pendientesCount() }}
            </span>
          </a>

        </div>
      </div>

      <!-- Child route content -->
      <div class="flex-1 flex flex-col">
        <router-outlet></router-outlet>
      </div>

    </div>
  `
})
export class InventoryLayoutComponent implements OnInit, OnDestroy {
  pendientesCount = signal<number>(0);
  private currentUrl = signal<string>('');
  private sub!: Subscription;

  // Contactos y Catálogos viven ahora solo en el sidebar (ver sidebar.component.ts) — no son
  // parte del flujo de la tab bar, así que no deben mostrarla al entrar a esas rutas.
  private static readonly HIDDEN_TAB_BAR_PATHS = ['/purchase-orders', '/inventario/contactos', '/inventario/catalogos'];

  showTabBar = computed(() => {
    const url = this.currentUrl();
    return !InventoryLayoutComponent.HIDDEN_TAB_BAR_PATHS.some((path) => url.includes(path));
  });

  constructor(
    private router: Router,
    private saleSyncLogsService: SaleSyncLogsService,
  ) {}

  ngOnInit(): void {
    this.currentUrl.set(this.router.url);
    this.sub = this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
    ).subscribe((e: any) => this.currentUrl.set(e.urlAfterRedirects));

    // Sin `store`, devuelve los sale-sync-issues no resueltos de TODAS las sedes — es el conteo
    // real que justifica el badge (antes nunca se alimentaba y siempre mostraba 0).
    this.saleSyncLogsService.getSyncLogs().subscribe({
      next: (issues) => this.pendientesCount.set(issues.length),
      error: () => {},
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
