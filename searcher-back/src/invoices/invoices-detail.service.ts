import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlegraApiService } from '../shared/alegra-api.service';
import { StoreCredentialsService } from '../shared/store-credentials.service';
import { Invoice } from '../entities/invoice.entity';

const num = (value: any): number => {
  const parsed = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Detalle de una factura de venta concreta (solo lectura).
 * Se consulta Alegra para tener el documento completo; si no responde se
 * devuelve la copia local, que puede venir sin ítems detallados.
 */
@Injectable()
export class InvoicesDetailService {
  private readonly logger = new Logger(InvoicesDetailService.name);
  private readonly maxPaymentsToEnrich = 10;

  constructor(
    private readonly alegra: AlegraApiService,
    private readonly storeCredentialsService: StoreCredentialsService,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
  ) {}

  async getInvoiceDetail(store: string, invoiceId: string): Promise<any> {
    let raw: any = null;

    try {
      raw = await this.alegra.get(store, `/invoices/${invoiceId}`);
    } catch (error) {
      this.logger.warn(`No se pudo traer la venta ${invoiceId} de ${store} desde Alegra: ${error.message}. Usando caché local.`);
    }

    let cachedBankNames: { paymentId: string; bankName: string; amount: number }[] = [];
    const cached = await this.findCached(store, invoiceId);
    if (cached) {
      cachedBankNames = cached.paymentBankAccounts || [];
    }

    if (!raw) {
      if (!cached) {
        throw new NotFoundException(`No se encontró la factura de venta ${invoiceId} en ${store}`);
      }
      raw = cached.data;
    }

    const payments = await this.enrichPayments(store, raw?.payments || [], cachedBankNames);
    return this.normalize(store, raw, payments);
  }

  async getCompany(store: string): Promise<any> {
    try {
      const company = await this.alegra.get<any>(store, '/company');
      const identification =
        typeof company?.identificationObject === 'object'
          ? company.identificationObject?.number
          : company?.identification;

      return {
        name: company?.name || this.storeCredentialsService.getStoreDisplayName(store),
        identification: identification || '',
        email: company?.email || '',
        phone: company?.phone || '',
        address: company?.address?.address || '',
        logo: company?.logo || '',
      };
    } catch (error) {
      this.logger.warn(`No se pudo cargar la empresa de ${store}: ${error.message}`);
      return { name: this.storeCredentialsService.getStoreDisplayName(store), identification: '', email: '', logo: '' };
    }
  }

  private async findCached(store: string, invoiceId: string): Promise<Invoice | null> {
    return this.invoiceRepository
      .createQueryBuilder('invoice')
      .where('invoice.store = :store', { store })
      .andWhere("invoice.data->>'id' = :invoiceId", { invoiceId: String(invoiceId) })
      .getOne();
  }

  /**
   * El listado de pagos que viene en la factura no trae el método ni el banco;
   * se consulta cada pago (con tope) y se cae al banco ya cacheado si falla.
   */
  private async enrichPayments(
    store: string,
    payments: any[],
    cachedBankNames: { paymentId: string; bankName: string; amount: number }[],
  ): Promise<any[]> {
    const bankByPaymentId = new Map(cachedBankNames.map((p) => [String(p.paymentId), p.bankName]));

    const enriched = await Promise.all(
      (payments || []).slice(0, this.maxPaymentsToEnrich).map(async (payment: any) => {
        const fallbackBank = bankByPaymentId.get(String(payment.id)) || '';
        let detail: any = null;

        try {
          detail = await this.alegra.get(store, `/payments/${payment.id}`);
        } catch (error) {
          this.logger.warn(`No se pudo cargar el pago ${payment.id} de ${store}: ${error.message}`);
        }

        const source = detail || payment;
        const bankAccount =
          source?.bankAccount?.name || source?.account?.name || payment?.bankAccount?.name || fallbackBank;

        return {
          id: payment.id,
          date: source?.date || payment?.date || null,
          number: source?.number ?? payment?.number ?? payment?.id,
          status: source?.status || payment?.status || '',
          paymentMethod: source?.paymentMethod || bankAccount || '',
          bankAccount,
          amount: num(payment?.amount ?? source?.amount ?? source?.total),
          observations: source?.observations || source?.anotation || '',
        };
      }),
    );

    // Los pagos que quedaron fuera del tope se muestran con lo que trae la factura
    const rest = (payments || []).slice(this.maxPaymentsToEnrich).map((payment: any) => ({
      id: payment.id,
      date: payment.date || null,
      number: payment.number ?? payment.id,
      status: payment.status || '',
      paymentMethod: payment.paymentMethod || bankByPaymentId.get(String(payment.id)) || '',
      bankAccount: bankByPaymentId.get(String(payment.id)) || '',
      amount: num(payment.amount),
      observations: payment.observations || '',
    }));

    return [...enriched, ...rest];
  }

  private normalize(store: string, raw: any, payments: any[]): any {
    const items = (raw?.items || []).map((item: any) => {
      const price = num(item.price);
      const quantity = num(item.quantity) || 0;
      const discount = num(item.discount);
      const taxes = (item.tax || item.taxes || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        percentage: num(t.percentage),
      }));
      const gross = price * quantity;
      const net = gross - (gross * discount) / 100;

      return {
        id: item.id,
        name: item.name || 'Sin nombre',
        reference: item.reference || '',
        description: item.description || '',
        observations: item.observations || '',
        price,
        quantity,
        discount,
        tax: taxes,
        taxPercentage: taxes.reduce((acc: number, t: any) => acc + num(t.percentage), 0),
        total: num(item.total) || net,
      };
    });

    const grossSubtotal = items.reduce((acc: number, item: any) => acc + item.price * item.quantity, 0);
    const discountTotal = items.reduce(
      (acc: number, item: any) => acc + (item.price * item.quantity * item.discount) / 100,
      0,
    );
    const netSubtotal = grossSubtotal - discountTotal;

    const retentions = (raw?.retentions || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      percentage: num(r.percentage),
      amount: num(r.amount),
    }));

    const total = num(raw?.total ?? netSubtotal);
    const retained = num(raw?.totalRetention) || retentions.reduce((acc: number, r: any) => acc + r.amount, 0);
    const collected = num(raw?.totalPaid ?? raw?.paid) || payments.reduce((acc: number, p: any) => acc + p.amount, 0);
    const balance = raw?.balance !== undefined && raw?.balance !== null ? num(raw.balance) : total - retained - collected;

    return {
      id: raw?.id,
      store,
      storeDisplayName: this.storeCredentialsService.getStoreDisplayName(store),
      number: raw?.numberTemplate?.number ?? raw?.number ?? raw?.id,
      fullNumber: raw?.numberTemplate?.fullNumber || raw?.numberTemplate?.number || raw?.number || '',
      date: raw?.date || null,
      dueDate: raw?.dueDate || null,
      status: raw?.status || 'open',
      paymentForm: raw?.paymentForm || '',
      paymentMethod: raw?.paymentMethod || '',
      documentType: raw?.numberTemplate?.documentType || raw?.type || '',
      observations: raw?.observations || '',
      anotation: raw?.anotation || '',
      termsConditions: raw?.termsConditions || '',
      client: {
        id: raw?.client?.id ?? null,
        name: raw?.client?.name || 'Consumidor Final',
        identification: raw?.client?.identification || '',
        identificationType: raw?.client?.identificationObject?.type || '',
        phone: raw?.client?.phonePrimary || raw?.client?.phone || raw?.client?.mobile || '',
        email: raw?.client?.email || '',
        address: raw?.client?.address?.address || raw?.client?.address || '',
      },
      seller: raw?.seller ? { id: raw.seller.id, name: raw.seller.name } : null,
      priceList: raw?.priceList ? { id: raw.priceList.id, name: raw.priceList.name } : null,
      warehouse: raw?.warehouse ? { id: raw.warehouse.id, name: raw.warehouse.name } : null,
      currency: raw?.currency?.code || 'COP',
      items,
      retentions,
      payments,
      totals: {
        grossSubtotal,
        discount: discountTotal,
        netSubtotal,
        tax: Math.max(0, total - netSubtotal),
        total,
        retained,
        collected,
        balance,
      },
    };
  }
}
