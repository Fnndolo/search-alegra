import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';

import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TimelineModule } from 'primeng/timeline';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { DividerModule } from 'primeng/divider';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

import { PurchaseOrdersService } from '../purchase-orders.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { InventoryApiService } from '../../services/inventory-api.service';
import { Color } from '../../models/inventory.models';

interface VariantInfo {
  productId: string;
  productName: string;
  sku: string;
  color: Color | null;
}

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    TagModule,
    ToastModule,
    TimelineModule,
    CardModule,
    DialogModule,
    InputTextModule,
    DividerModule,
    ProgressSpinnerModule,
  ],
  providers: [MessageService],
  templateUrl: './order-detail.component.html',
})
export class OrderDetailComponent implements OnInit {
  loading = signal(true);
  order: any = null;
  history: any[] = [];
  /**
   * Signal, not a plain Map: `InventoryLayoutComponent` (an ancestor wrapping the router-outlet)
   * uses `ChangeDetectionStrategy.OnPush`. A plain-property mutation from an async HTTP callback
   * (no signal write, no event, no @Input change) never marks that OnPush ancestor dirty, so
   * Angular silently skips re-checking this whole subtree — the map would update with correct
   * data but the template would never re-render to show it. Signals bypass that via their own
   * local reactivity, independent of the OnPush zone-based dirty-marking chain.
   */
  private variantsById = signal(new Map<string, VariantInfo>());

  // Non-draft actions (admin-only)
  cancelling = signal(false);
  retrying = signal(false);
  cancelDialogVisible = false;
  cancelReason = '';

  // Draft-lifecycle actions (admin + facturacion)
  submittingDraft = signal(false);
  deletingDraft = signal(false);
  deleteDraftDialogVisible = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly service: PurchaseOrdersService,
    private readonly messageService: MessageService,
    private readonly authService: AuthService,
    private readonly inventoryApi: InventoryApiService,
  ) {}

  get isAdmin(): boolean {
    return this.authService.hasRole(['admin']);
  }

  get canManageDraft(): boolean {
    return this.authService.hasRole(['admin', 'facturacion']);
  }

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.loadOrder(id);
  }

  private loadOrder(id: number): void {
    this.loading.set(true);
    this.service.findOne(id).subscribe({
      next: (res) => {
        this.order = res.order ?? res;
        this.history = res.history ?? [];
        this.loading.set(false);
        this.loadVariantInfo();
      },
      error: () => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'No se pudo cargar la orden',
        });
        this.loading.set(false);
      },
    });
  }

  /** Resolves each item's `productVariantId` to its product name + color + SKU for display. */
  private loadVariantInfo(): void {
    const ids: string[] = (this.order?.items ?? [])
      .map((item: any) => item.productVariantId ?? item.product_variant_id)
      .filter((id: string | null | undefined): id is string => !!id);
    if (!ids.length) return;

    this.inventoryApi.getVariantsByIds(ids).subscribe({
      next: (variants) => {
        this.variantsById.set(new Map(variants.map((v) => [v.id, v])));
      },
      error: () => {},
    });
  }

  variantInfo(item: any): VariantInfo | null {
    const id = item.productVariantId ?? item.product_variant_id;
    return id ? this.variantsById().get(id) ?? null : null;
  }

  // ─── Non-draft actions (admin only) ─────────────────────────────────────────

  openCancelDialog(): void {
    this.cancelReason = '';
    this.cancelDialogVisible = true;
  }

  confirmCancel(): void {
    this.cancelling.set(true);
    this.service.cancel(this.order.id, this.cancelReason).subscribe({
      next: () => {
        this.cancelling.set(false);
        this.cancelDialogVisible = false;
        this.messageService.add({
          severity: 'success',
          summary: 'Orden anulada',
          detail: 'La orden fue anulada y el inventario revertido.',
        });
        this.loadOrder(this.order.id);
      },
      error: (err) => {
        this.cancelling.set(false);
        const detail = err.error?.message ?? 'Error al anular la orden';
        this.messageService.add({ severity: 'error', summary: 'Error', detail, life: 8000 });
      },
    });
  }

  retryInventory(): void {
    this.retrying.set(true);
    this.service.retryInventory(this.order.id).subscribe({
      next: () => {
        this.retrying.set(false);
        this.messageService.add({
          severity: 'success',
          summary: 'Inventario sincronizado',
          detail: 'El inventario fue actualizado correctamente.',
        });
        this.loadOrder(this.order.id);
      },
      error: (err) => {
        this.retrying.set(false);
        const detail = err.error?.message ?? 'Error al reintentar inventario';
        this.messageService.add({ severity: 'error', summary: 'Error', detail, life: 8000 });
      },
    });
  }

  // ─── Draft lifecycle (admin + facturacion) ───────────────────────────────────

  editDraft(): void {
    this.router.navigate(['/inventario/purchase-orders', this.order.id, 'edit']);
  }

  submitDraftAction(): void {
    this.submittingDraft.set(true);
    this.service.submitDraft(this.order.id).subscribe({
      next: (updated) => {
        this.submittingDraft.set(false);
        if (updated.status === 'serial_duplicated') {
          this.messageService.add({
            severity: 'warn',
            summary: 'Enviado con seriales duplicados',
            detail: 'Revisá los items para ver los IMEIs duplicados.',
            life: 8000,
          });
        } else {
          this.messageService.add({
            severity: 'success',
            summary: 'Orden enviada a Alegra',
            detail: `ID Alegra: ${updated.alegra_id}`,
          });
        }
        this.loadOrder(this.order.id);
      },
      error: (err) => {
        this.submittingDraft.set(false);
        const detail = err.error?.message ?? 'Error al enviar a Alegra';
        this.messageService.add({ severity: 'error', summary: 'Error', detail, life: 8000 });
      },
    });
  }

  confirmDeleteDraft(): void {
    this.deleteDraftDialogVisible = true;
  }

  doDeleteDraft(): void {
    this.deletingDraft.set(true);
    this.service.deleteDraft(this.order.id).subscribe({
      next: () => {
        this.deletingDraft.set(false);
        this.deleteDraftDialogVisible = false;
        this.messageService.add({ severity: 'success', summary: 'Borrador eliminado' });
        this.router.navigate(['/inventario/purchase-orders']);
      },
      error: (err) => {
        this.deletingDraft.set(false);
        const detail = err.error?.message ?? 'Error al eliminar el borrador';
        this.messageService.add({ severity: 'error', summary: 'Error', detail, life: 8000 });
      },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  statusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    const map: Record<string, 'success' | 'warn' | 'danger' | 'info' | 'secondary'> = {
      active: 'success',
      serial_duplicated: 'warn',
      cancelled: 'danger',
      draft: 'secondary',
    };
    return map[status] ?? 'info';
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = {
      active: 'Activa',
      serial_duplicated: 'Serial duplicado',
      cancelled: 'Anulada',
      draft: 'Borrador',
    };
    return map[status] ?? status;
  }

  actionLabel(action: string): string {
    const map: Record<string, string> = {
      created: 'Orden creada',
      edited: 'Orden editada',
      cancelled: 'Orden anulada',
      inventory_synced: 'Inventario sincronizado',
      serial_conflict: 'Conflicto de seriales',
      retry_inventory: 'Reintento de inventario',
      alegra_status_updated: 'Estado Alegra actualizado',
      draft_submitted: 'Borrador enviado a Alegra',
    };
    return map[action] ?? action;
  }

  goBack(): void {
    this.router.navigate(['/inventario/purchase-orders']);
  }
}
