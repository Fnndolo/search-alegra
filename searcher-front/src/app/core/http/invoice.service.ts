import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class InvoiceService {
  private apiUrl = environment.API_URL;

  constructor(private http: HttpClient) {}

  getAllInvoices(store?: string, page = 1, limit = 30, search?: string, status?: string, dateFrom?: Date | null, dateTo?: Date | null): Observable<any> {
    let params = new HttpParams().set('page', page).set('limit', limit);
    if (store) params = params.set('store', store);
    if (search?.trim()) params = params.set('search', search.trim());
    if (status) params = params.set('status', status);
    if (dateFrom) params = params.set('dateFrom', dateFrom.toISOString().split('T')[0]);
    if (dateTo) params = params.set('dateTo', dateTo.toISOString().split('T')[0]);
    return this.http.get<any>(`${this.apiUrl}/invoices/all`, { params });
  }

  updateInvoices(store?: string): Observable<any> {
    const params = store ? `?store=${store}` : '';
    return this.http.get<any>(`${this.apiUrl}/invoices/update${params}`);
  }

  syncMissingPayments(store?: string): Observable<any> {
    const params = store ? `?store=${store}` : '';
    return this.http.get<any>(`${this.apiUrl}/invoices/sync-missing-payments${params}`);
  }

  getAllPurchaseInvoices(store?: string, page = 1, limit = 30, search?: string, status?: string, dateFrom?: Date | null, dateTo?: Date | null): Observable<any> {
    let params = new HttpParams().set('page', page).set('limit', limit);
    if (store) params = params.set('store', store);
    if (search?.trim()) params = params.set('search', search.trim());
    if (status) params = params.set('status', status);
    if (dateFrom) params = params.set('dateFrom', dateFrom.toISOString().split('T')[0]);
    if (dateTo) params = params.set('dateTo', dateTo.toISOString().split('T')[0]);
    return this.http.get<any>(`${this.apiUrl}/bills/all`, { params }).pipe(
      catchError(() => of({ updating: false, progress: 0, data: [], total: 0, page: 1, limit })),
    );
  }

  updatePurchaseInvoices(store?: string): Observable<any> {
    const params = store ? `?store=${store}` : '';
    return this.http.get<any>(`${this.apiUrl}/bills/update${params}`).pipe(
      catchError(() => of({ updating: false, progress: 0, data: [] })),
    );
  }
}
