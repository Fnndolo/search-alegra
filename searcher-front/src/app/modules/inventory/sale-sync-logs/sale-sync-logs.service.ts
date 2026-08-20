import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type SaleSyncIssueReason =
  | 'NO_MAPPING'
  | 'NO_IMEI_MATCH'
  | 'PARTIAL_MATCH'
  | 'MULTI_VARIANT_FUNGIBLE'
  | 'NO_VARIANTS';

export interface SaleSyncIssue {
  id: string;
  store_key: string;
  alegra_invoice_id: string;
  alegra_item_id: number;
  reason: SaleSyncIssueReason;
  details: string | null;
  quantity_expected: number;
  quantity_resolved: number;
  resolved: boolean;
  created_at: string;
  updated_at: string;
}

@Injectable({ providedIn: 'root' })
export class SaleSyncLogsService {
  private readonly base = `${environment.API_URL}/inventory/sales`;

  constructor(private readonly http: HttpClient) {}

  getSyncLogs(store?: string): Observable<SaleSyncIssue[]> {
    let params = new HttpParams();
    if (store) params = params.set('store', store);
    return this.http.get<SaleSyncIssue[]>(`${this.base}/sync-logs`, { params });
  }

  retry(invoiceId: string, store: string): Observable<SaleSyncIssue[]> {
    let params = new HttpParams().set('store', store);
    return this.http.post<SaleSyncIssue[]>(`${this.base}/${invoiceId}/retry`, {}, { params });
  }
}
