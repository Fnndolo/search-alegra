import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface DocumentTotals {
  grossSubtotal: number;
  discount: number;
  netSubtotal: number;
  tax: number;
  total: number;
  retained: number;
  debitNotes?: number;
  paid?: number;
  collected?: number;
  balance: number;
}

export interface DocumentItem {
  id: number | string;
  name: string;
  reference?: string;
  description?: string;
  observations?: string;
  price: number;
  quantity: number;
  discount: number;
  tax: { id: number | string; name: string; percentage: number }[];
  taxPercentage: number;
  total: number;
}

export interface BillDetail {
  id: number | string;
  store: string;
  storeDisplayName: string;
  number: string | number;
  fullNumber: string;
  date: string | null;
  dueDate: string | null;
  status: string;
  /** "Notas" del documento en Alegra */
  observations: string;
  /** Anotación interna de Alegra; se muestra pero no se edita */
  anotation: string;
  termsConditions: string;
  provider: { id: number | null; name: string; identification: string; phone: string; email: string };
  warehouse: { id: number | string; name: string } | null;
  items: DocumentItem[];
  retentions: { id: number; name: string; percentage: number; amount: number }[];
  debitNotes: { id: number; number: string; date: string | null; amount: number }[];
  payments: { id: number; date: string | null; amount: number; paymentMethod: string; observations: string; status: string }[];
  totals: DocumentTotals;
}

export interface InvoiceDetail {
  id: number | string;
  store: string;
  storeDisplayName: string;
  number: string | number;
  fullNumber: string;
  date: string | null;
  dueDate: string | null;
  status: string;
  paymentForm: string;
  paymentMethod: string;
  documentType: string;
  observations: string;
  anotation: string;
  termsConditions: string;
  client: {
    id: number | null;
    name: string;
    identification: string;
    identificationType: string;
    phone: string;
    email: string;
    address: string;
  };
  seller: { id: number; name: string } | null;
  priceList: { id: number; name: string } | null;
  warehouse: { id: number; name: string } | null;
  items: DocumentItem[];
  retentions: { id: number; name: string; percentage: number; amount: number }[];
  payments: {
    id: number;
    date: string | null;
    number: string | number;
    status: string;
    paymentMethod: string;
    bankAccount: string;
    amount: number;
    observations: string;
  }[];
  totals: DocumentTotals;
}

export interface CompanyInfo {
  name: string;
  identification: string;
  email: string;
  phone?: string;
  address?: string;
  logo?: string;
}

export interface BillUpdatePayload {
  date?: string;
  dueDate?: string;
  provider?: number | string;
  warehouse?: number | string;
  numberTemplate?: { number: string | number };
  observations?: string;
  termsConditions?: string;
  items: {
    id?: number | string;
    price: number;
    quantity: number;
    discount: number;
    observations?: string;
    tax?: { id: number | string }[];
  }[];
}

/** Acceso a un documento concreto (compra o venta) y a los catálogos de edición */
@Injectable({ providedIn: 'root' })
export class DocumentService {
  private http = inject(HttpClient);
  private apiUrl = environment.API_URL;

  getBillDetail(store: string, id: string): Observable<BillDetail> {
    const params = new HttpParams().set('store', store).set('id', id);
    return this.http.get<BillDetail>(`${this.apiUrl}/bills/detail`, { params });
  }

  updateBill(store: string, id: string, payload: BillUpdatePayload): Observable<BillDetail> {
    const params = new HttpParams().set('store', store);
    return this.http.put<BillDetail>(`${this.apiUrl}/bills/${id}`, payload, { params });
  }

  getInvoiceDetail(store: string, id: string): Observable<InvoiceDetail> {
    const params = new HttpParams().set('store', store).set('id', id);
    return this.http.get<InvoiceDetail>(`${this.apiUrl}/invoices/detail`, { params });
  }

  getBillCompany(store: string): Observable<CompanyInfo> {
    return this.http.get<CompanyInfo>(`${this.apiUrl}/bills/company`, { params: new HttpParams().set('store', store) });
  }

  getInvoiceCompany(store: string): Observable<CompanyInfo> {
    return this.http.get<CompanyInfo>(`${this.apiUrl}/invoices/company`, { params: new HttpParams().set('store', store) });
  }

  // ─── Catálogos del formulario de edición de compras ───────────────────

  getProviders(store: string, query?: string): Observable<{ id: number; name: string; identification: string; phone: string }[]> {
    let params = new HttpParams().set('store', store);
    if (query) params = params.set('query', query);
    return this.http.get<any[]>(`${this.apiUrl}/bills/catalog/providers`, { params });
  }

  createProvider(
    store: string,
    data: { name: string; identification?: string; phone?: string; email?: string },
  ): Observable<{ id: number; name: string; identification: string; phone: string }> {
    const params = new HttpParams().set('store', store);
    return this.http.post<any>(`${this.apiUrl}/bills/catalog/providers`, data, { params });
  }

  getItems(store: string, query?: string): Observable<{ id: number; name: string; reference: string; price: number }[]> {
    let params = new HttpParams().set('store', store);
    if (query) params = params.set('query', query);
    return this.http.get<any[]>(`${this.apiUrl}/bills/catalog/items`, { params });
  }

  getWarehouses(store: string): Observable<{ id: number; name: string; isDefault: boolean }[]> {
    return this.http.get<any[]>(`${this.apiUrl}/bills/catalog/warehouses`, { params: new HttpParams().set('store', store) });
  }

  getTaxes(store: string): Observable<{ id: number; name: string; percentage: number; type: string }[]> {
    return this.http.get<any[]>(`${this.apiUrl}/bills/catalog/taxes`, { params: new HttpParams().set('store', store) });
  }
}
