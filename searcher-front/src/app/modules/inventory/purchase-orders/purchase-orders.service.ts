import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface PurchaseOrderUnit {
  identifier: string | null;
}

export interface PurchaseOrderItemForm {
  productId: string;
  /** Omitted when the product was never published in this warehouse — the backend auto-creates
   *  the Alegra item and resolves this id before building the bill. */
  alegraItemId?: number | null;
  /** Color/SKU variant chosen for this item — required so the backend can attribute stock correctly. */
  productVariantId?: string | null;
  name: string;
  price: number;
  quantity: number;
  requiresSerial: boolean;
  units: PurchaseOrderUnit[];
}

export interface CreatePurchaseOrderPayload {
  store: string;
  providerId: number;
  providerName: string;
  providerIdentification?: string;
  date: string;
  dueDate: string;
  alegraWarehouseId: string;
  alegraWarehouseName: string;
  warehouseId?: string;
  observations?: string;
  items: PurchaseOrderItemForm[];
}

@Injectable({ providedIn: 'root' })
export class PurchaseOrdersService {
  private readonly base = `${environment.API_URL}/purchase-orders`;
  private readonly inventoryBase = `${environment.API_URL}/inventory`;

  constructor(private readonly http: HttpClient) {}

  create(payload: CreatePurchaseOrderPayload): Observable<any> {
    return this.http.post(this.base, payload);
  }

  findAll(params: Record<string, any>): Observable<any> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    }
    return this.http.get(this.base, { params: p });
  }

  findOne(id: number): Observable<any> {
    return this.http.get(`${this.base}/${id}`);
  }

  update(id: number, payload: Partial<CreatePurchaseOrderPayload>): Observable<any> {
    return this.http.put(`${this.base}/${id}`, payload);
  }

  cancel(id: number, reason?: string): Observable<any> {
    return this.http.post(`${this.base}/${id}/cancel`, { reason });
  }

  getSyncLogs(): Observable<any> {
    return this.http.get(`${this.base}/sync-logs`);
  }

  retryInventory(id: number): Observable<any> {
    return this.http.post(`${this.base}/${id}/retry-inventory`, {});
  }

  createWarehouse(payload: { store: string; storeId: string; name: string }): Observable<any> {
    return this.http.post(`${this.base}/warehouses`, payload);
  }

  searchProviders(store: string, keywords: string): Observable<any[]> {
    // Reads from the local Alegra-contacts cache (lazily synced), not the live Alegra API.
    const params: any = { store, type: 'provider' };
    if (keywords) params.search = keywords;
    return this.http.get<any[]>(`${this.inventoryBase}/contacts`, { params });
  }

  syncContacts(storeKey: string): Observable<{ synced: number }> {
    return this.http.post<{ synced: number }>(`${this.inventoryBase}/stores/${storeKey}/sync-contacts`, {});
  }

  searchItems(store: string, keywords: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.inventoryBase}/alegra/items`, {
      params: { store, keywords },
    });
  }

  getWarehouses(storeKey: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.inventoryBase}/stores/${storeKey}/warehouses`);
  }

  createDraft(payload: Partial<CreatePurchaseOrderPayload>): Observable<any> {
    return this.http.post(this.base, { ...payload, draft: true });
  }

  deleteDraft(id: number): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.base}/${id}`);
  }

  submitDraft(id: number): Observable<any> {
    return this.http.post(`${this.base}/${id}/submit`, {});
  }

  updateDraft(id: number, payload: Partial<CreatePurchaseOrderPayload>): Observable<any> {
    return this.http.put(`${this.base}/${id}`, payload);
  }

  getSyncCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.base}/sync-count`);
  }
}
