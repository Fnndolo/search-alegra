import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface InvoiceItem {
    id: string;
    name: string;
    description: string;
    quantity: number;
    price: number;
    total: number;
    tax: any[];
    selected?: boolean;
}

export interface PaymentBankAccount {
    paymentId: string;
    bankName: string;
    amount: number;
}

export interface BillingInvoice {
    id: number;
    store: string;
    storeDisplayName: string;
    billingStatus: string;
    selectedItemIds: string[] | null;
    number: string;
    client: string;
    clientId: string;
    clientAddress: string;
    clientPhone: string;
    clientEmail: string;
    productName: string;
    items: InvoiceItem[];
    itemsCount: number;
    selectedItemsCount: number;
    paymentBankAccounts: PaymentBankAccount[];
    subtotal: number;
    totalTax: number;
    total: number;
    date: string;
    dueDate: string;
    seller: string;
    observations: string;
    createdAt: string;
}

export interface BillingInvoicesResponse {
    total: number;
    data: BillingInvoice[];
}

@Injectable({ providedIn: 'root' })
export class ElectronicBillingService {
    private apiUrl = environment.API_URL;

    constructor(private http: HttpClient) { }

    getInvoices(status?: string, store?: string): Observable<BillingInvoicesResponse> {
        const params: string[] = [];
        if (status) params.push(`status=${status}`);
        if (store) params.push(`store=${store}`);
        const query = params.length > 0 ? `?${params.join('&')}` : '';
        return this.http.get<BillingInvoicesResponse>(`${this.apiUrl}/electronic-billing/invoices${query}`);
    }

    updateStatus(invoiceIds: { id: number, store: string }[], status: string): Observable<any> {
        return this.http.patch(`${this.apiUrl}/electronic-billing/invoices/status`, {
            invoiceIds,
            status
        });
    }

    updateSelectedItems(id: number, store: string, selectedItemIds: string[]): Observable<any> {
        return this.http.patch(`${this.apiUrl}/electronic-billing/invoices/items`, {
            id,
            store,
            selectedItemIds
        });
    }

    /** Obtiene configuración de Kupocell (bodegas, centros de costo, mapeo de tiendas) */
    getKupocellConfig(): Observable<{
        warehouses: { id: string, name: string }[],
        costCenters: { id: string, name: string }[],
        storeMappings: Record<string, { warehouseId: string, costCenterId: string }>
    }> {
        return this.http.get<any>(`${this.apiUrl}/electronic-billing/kupocell-config`);
    }

    /** Crea facturas en Kupocell */
    createKupocellInvoice(payload: {
        invoiceIds: { id: number, store: string }[],
        warehouseId: string,
        costCenterId: string,
        applyIva: boolean,
    }): Observable<any> {
        return this.http.post(`${this.apiUrl}/electronic-billing/create-kupocell-invoice`, payload);
    }

    // ─── Product Mappings ─────────────────────────────────────────

    getKupocellProducts(sync = false): Observable<{ id: string, name: string }[]> {
        return this.http.get<any>(`${this.apiUrl}/electronic-billing/kupo-products?sync=${sync}`);
    }

    getProductMappings(): Observable<any[]> {
        return this.http.get<any[]>(`${this.apiUrl}/electronic-billing/product-mappings`);
    }

    /** Guardado incremental: solo filas nuevas/modificadas (upserts) + ids eliminados. */
    saveProductMappings(upserts: any[], deletedIds: string[] = []): Observable<any> {
        return this.http.put(`${this.apiUrl}/electronic-billing/product-mappings`, { upserts, deletedIds });
    }

    // ─── Bank Mappings ────────────────────────────────────────────

    getKupocellBanks(sync = false): Observable<{ id: string, name: string }[]> {
        return this.http.get<any>(`${this.apiUrl}/electronic-billing/kupo-banks?sync=${sync}`);
    }

    getBankMappings(): Observable<any[]> {
        return this.http.get<any[]>(`${this.apiUrl}/electronic-billing/bank-mappings`);
    }

    /** Guardado incremental: solo filas nuevas/modificadas (upserts) + ids eliminados. */
    saveBankMappings(upserts: any[], deletedIds: string[] = []): Observable<any> {
        return this.http.put(`${this.apiUrl}/electronic-billing/bank-mappings`, { upserts, deletedIds });
    }

    // ─── Mass Billing Excel Upload ────────────────────────────────

    uploadExcelForMassBilling(file: File): Observable<any> {
        const formData = new FormData();
        formData.append('file', file);
        return this.http.post(`${this.apiUrl}/electronic-billing/process-excel`, formData);
    }

    /** Consulta el progreso de un import job en background (para polling). */
    getImportJob(jobId: string): Observable<any> {
        return this.http.get<any>(`${this.apiUrl}/electronic-billing/jobs/${jobId}`);
    }

    // ─── Sync Logs ────────────────────────────────────────────────

    getSyncLogs(): Observable<any[]> {
        return this.http.get<any[]>(`${this.apiUrl}/electronic-billing/sync-logs`);
    }
}
