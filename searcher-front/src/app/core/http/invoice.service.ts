import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class InvoiceService {
  private apiUrl = environment.API_URL + '/invoices';
  constructor(private http: HttpClient) {}

  getAllInvoices(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/all`);
  }

  updateInvoices(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/update`);
  }
}
