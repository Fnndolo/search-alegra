import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class InvoiceService {
  private apiUrl = environment.API_URL;

  constructor(private http: HttpClient) {}

  // Métodos para facturas de venta (invoices)
  getAllInvoices(store?: string): Observable<any> {
    const params = store ? `?store=${store}` : '';
    const fullUrl = `${this.apiUrl}/invoices/all${params}`;
    console.log('🌐 Service: Llamando a', fullUrl);
    return this.http.get<any>(fullUrl);
  }

  updateInvoices(store?: string): Observable<any> {
    const params = store ? `?store=${store}` : '';
    return this.http.get<any>(`${this.apiUrl}/invoices/update${params}`);
  }

  // Métodos para facturas de compra (bills)
  getAllPurchaseInvoices(store?: string): Observable<any> {
    const params = store ? `?store=${store}` : '';
    const fullUrl = `${this.apiUrl}/bills/all${params}`;
    console.log('🌐 Service: Llamando a', fullUrl);
    return this.http.get<any>(fullUrl).pipe(
      catchError(error => {
        console.error('Endpoint de facturas de compra no disponible:', error);
        return of({ updating: false, progress: 0, data: [] });
      })
    );
  }

  updatePurchaseInvoices(store?: string): Observable<any> {
    const params = store ? `?store=${store}` : '';
    return this.http.get<any>(`${this.apiUrl}/bills/update${params}`).pipe(
      catchError(error => {
        console.error('Endpoint de facturas de compra no disponible:', error);
        return of({ updating: false, progress: 0, data: [] });
      })
    );
  }
}
