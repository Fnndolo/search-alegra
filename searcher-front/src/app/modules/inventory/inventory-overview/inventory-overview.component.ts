import { Component, OnInit, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { InventoryApiService } from '../services/inventory-api.service';
import { InventoryStats, StockByStore } from '../models/inventory.models';

@Component({
  selector: 'app-inventory-overview',
  standalone: true,
  imports: [CommonModule, RouterModule, TagModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6 p-4 md:p-6">

      <!-- Loading skeleton -->
      <ng-container *ngIf="loading()">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div *ngFor="let i of [1,2,3,4]"
               class="h-28 bg-white rounded-xl border border-surface-200 animate-pulse"></div>
        </div>
        <div class="h-48 bg-white rounded-xl border border-surface-200 animate-pulse"></div>
        <div class="h-64 bg-white rounded-xl border border-surface-200 animate-pulse"></div>
      </ng-container>

      <ng-container *ngIf="!loading() && stats()">

        <!-- ── Summary cards ── -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">

          <div class="bg-white rounded-xl border border-surface-200 shadow-sm p-5 flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-surface-400 uppercase tracking-wide">Productos</span>
              <div class="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                <i class="pi pi-box text-blue-500"></i>
              </div>
            </div>
            <div class="text-3xl font-bold text-surface-900 tabular-nums">
              {{ stats()!.summary.totalProducts }}
            </div>
            <a routerLink="/inventario/productos"
               class="text-xs text-primary-500 hover:text-primary-700 font-medium mt-auto">
              Ver productos →
            </a>
          </div>

          <div class="bg-white rounded-xl border border-surface-200 shadow-sm p-5 flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-surface-400 uppercase tracking-wide">Unidades</span>
              <div class="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center">
                <i class="pi pi-list text-violet-500"></i>
              </div>
            </div>
            <div class="text-3xl font-bold text-surface-900 tabular-nums">
              {{ stats()!.summary.totalVariants }}
            </div>
            <span class="text-xs text-surface-400 mt-auto">SKUs activos</span>
          </div>

          <div class="bg-white rounded-xl border border-surface-200 shadow-sm p-5 flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-surface-400 uppercase tracking-wide">Disponibles</span>
              <div class="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                <i class="pi pi-check-circle text-emerald-500"></i>
              </div>
            </div>
            <div class="text-3xl font-bold text-emerald-700 tabular-nums">
              {{ stats()!.summary.available }}
            </div>
            <span class="text-xs text-surface-400 mt-auto">En stock activo</span>
          </div>

          <div class="bg-white rounded-xl border border-surface-200 shadow-sm p-5 flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-surface-400 uppercase tracking-wide">Salidas</span>
              <div class="w-9 h-9 rounded-lg bg-surface-50 flex items-center justify-center">
                <i class="pi pi-arrow-right text-surface-400"></i>
              </div>
            </div>
            <div class="text-3xl font-bold text-surface-700 tabular-nums">
              {{ stats()!.summary.sold }}
            </div>
            <span class="text-xs text-surface-400 mt-auto">Unidades vendidas</span>
          </div>

        </div>

        <!-- ── Stock por tienda ── -->
        <div class="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
          <div class="px-5 py-4 border-b border-surface-100">
            <h2 class="font-semibold text-surface-900">Stock por tienda</h2>
            <p class="text-xs text-surface-400 mt-0.5">Unidades activas por sede</p>
          </div>

          <div *ngIf="!stats()!.stockByStore.length"
               class="px-5 py-10 text-center text-sm text-surface-400">
            Sin datos de stock aún.
          </div>

          <div *ngIf="stats()!.stockByStore.length" class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-surface-50 border-b border-surface-200">
                  <th class="px-5 py-3 text-left text-xs font-semibold text-surface-500 uppercase tracking-wide">Sede</th>
                  <th class="px-5 py-3 text-center text-xs font-semibold text-red-500 uppercase tracking-wide">Sin stock</th>
                  <th class="px-5 py-3 text-center text-xs font-semibold text-emerald-500 uppercase tracking-wide">Con stock</th>
                  <th class="px-5 py-3 text-left text-xs font-semibold text-surface-500 uppercase tracking-wide">Distribución</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let s of stats()!.stockByStore"
                    class="border-b border-surface-100 hover:bg-surface-50">
                  <td class="px-5 py-3 font-medium text-surface-800">{{ s.name }}</td>
                  <td class="px-5 py-3 text-center">
                    <span class="font-bold tabular-nums"
                          [class.text-red-600]="s.outOfStock > 0"
                          [class.text-surface-400]="s.outOfStock === 0">
                      {{ s.outOfStock }}
                    </span>
                  </td>
                  <td class="px-5 py-3 text-center">
                    <span class="font-bold tabular-nums text-emerald-600">{{ s.inStock }}</span>
                  </td>
                  <td class="px-5 py-3">
                    <div class="flex h-2 rounded-full overflow-hidden w-full max-w-[160px] bg-surface-100">
                      <div class="bg-red-400 transition-all"
                           [style.width.%]="pct(s.outOfStock, s)"
                           [pTooltip]="s.outOfStock + ' sin stock'"></div>
                      <div class="bg-emerald-400 transition-all"
                           [style.width.%]="pct(s.inStock, s)"
                           [pTooltip]="s.inStock + ' con stock'"></div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </ng-container>

      <!-- Error state -->
      <div *ngIf="!loading() && error()"
           class="bg-white rounded-xl border border-red-200 shadow-sm px-5 py-10 text-center flex flex-col items-center gap-2">
        <i class="pi pi-exclamation-circle text-2xl text-red-400"></i>
        <span class="text-sm text-red-500">No se pudieron cargar las estadísticas.</span>
        <button (click)="load()"
                class="mt-2 text-xs px-4 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-medium transition-colors">
          Reintentar
        </button>
      </div>

    </div>
  `
})
export class InventoryOverviewComponent implements OnInit {
  stats = signal<InventoryStats | null>(null);
  loading = signal(true);
  error = signal(false);

  constructor(private api: InventoryApiService) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(false);
    this.api.getStats().subscribe({
      next: (data) => {
        this.stats.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      }
    });
  }

  pct(value: number, store: StockByStore): number {
    const total = store.outOfStock + store.inStock;
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
  }
}
