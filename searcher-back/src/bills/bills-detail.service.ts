import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlegraApiService } from '../shared/alegra-api.service';
import { StoreCredentialsService } from '../shared/store-credentials.service';
import { Bill } from '../entities/bill.entity';

export interface BillItemPayload {
  id?: number | string;
  name?: string;
  price?: number;
  quantity?: number;
  discount?: number;
  observations?: string;
  description?: string;
  tax?: Array<{ id: number | string }>;
}

export interface BillUpdatePayload {
  date?: string;
  dueDate?: string;
  provider?: number | string;
  numberTemplate?: { number?: string | number };
  warehouse?: number | string;
  /** "Notas" del documento. `anotation` NO se envía nunca, para no pisarla. */
  observations?: string;
  termsConditions?: string;
  items?: BillItemPayload[];
}

const num = (value: any): number => {
  const parsed = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Lectura y edición de una cuenta por pagar (factura de compra) concreta.
 * A diferencia de BillsDbService —que sincroniza listados en bloque— aquí
 * siempre se va a Alegra por el documento completo (ítems, pagos, retenciones)
 * y se refresca la copia local con lo que responda.
 */
@Injectable()
export class BillsDetailService {
  private readonly logger = new Logger(BillsDetailService.name);

  constructor(
    private readonly alegra: AlegraApiService,
    private readonly storeCredentialsService: StoreCredentialsService,
    @InjectRepository(Bill)
    private readonly billRepository: Repository<Bill>,
  ) {}

  /** Obtiene el documento completo desde Alegra; si falla, cae a la copia en base de datos */
  async getBillDetail(store: string, billId: string): Promise<any> {
    let raw: any = null;

    try {
      raw = await this.alegra.get(store, `/bills/${billId}`);
      if (raw) {
        await this.persist(store, raw);
      }
    } catch (error) {
      this.logger.warn(`No se pudo traer la compra ${billId} de ${store} desde Alegra: ${error.message}. Usando caché local.`);
    }

    if (!raw) {
      const cached = await this.findCached(store, billId);
      if (!cached) {
        throw new NotFoundException(`No se encontró la factura de compra ${billId} en ${store}`);
      }
      raw = cached.data;
    }

    return this.normalize(store, raw);
  }

  /** Envía los cambios a Alegra y devuelve el documento actualizado ya normalizado */
  async updateBill(store: string, billId: string, payload: BillUpdatePayload): Promise<any> {
    const body = this.buildUpdateBody(payload);
    this.logger.log(`✏️ Actualizando compra ${billId} de ${store}: ${JSON.stringify(body).slice(0, 500)}`);

    const updated = await this.alegra.put(store, `/bills/${billId}`, body);
    await this.persist(store, updated);

    return this.normalize(store, updated);
  }

  // ─── Catálogos para el formulario de edición ──────────────────────────

  async getProviders(store: string, query?: string): Promise<any[]> {
    const contacts = await this.alegra.get<any[]>(store, '/contacts', {
      type: 'provider',
      limit: 100,
      ...(query ? { query } : {}),
    });

    return (contacts || []).map((contact) => ({
      id: contact.id,
      name: contact.name,
      identification: contact.identification || '',
      phone: contact.phonePrimary || contact.phone || contact.mobile || '',
    }));
  }

  async createProvider(store: string, data: { name: string; identification?: string; phone?: string; email?: string }): Promise<any> {
    const created = await this.alegra.post(store, '/contacts', {
      name: data.name,
      ...(data.identification ? { identification: data.identification } : {}),
      ...(data.phone ? { phonePrimary: data.phone } : {}),
      ...(data.email ? { email: data.email } : {}),
      type: ['provider'],
    });

    return {
      id: created?.id,
      name: created?.name,
      identification: created?.identification || '',
      phone: created?.phonePrimary || created?.phone || created?.mobile || '',
    };
  }

  async getItems(store: string, query?: string): Promise<any[]> {
    const items = await this.alegra.get<any[]>(store, '/items', {
      limit: 100,
      ...(query ? { query } : {}),
    });

    return (items || []).map((item) => ({
      id: item.id,
      name: item.name,
      reference: item.reference || '',
      price: this.pickItemPrice(item),
    }));
  }

  async getWarehouses(store: string): Promise<any[]> {
    try {
      const warehouses = await this.alegra.get<any[]>(store, '/warehouses', { limit: 100 });
      return (warehouses || []).map((w) => ({ id: w.id, name: w.name, isDefault: !!w.isDefault }));
    } catch (error) {
      this.logger.warn(`No se pudieron cargar las bodegas de ${store}: ${error.message}`);
      return [];
    }
  }

  async getTaxes(store: string): Promise<any[]> {
    try {
      const taxes = await this.alegra.get<any[]>(store, '/taxes');
      return (taxes || []).map((t) => ({
        id: t.id,
        name: t.name,
        percentage: num(t.percentage),
        type: t.type,
      }));
    } catch (error) {
      this.logger.warn(`No se pudieron cargar los impuestos de ${store}: ${error.message}`);
      return [];
    }
  }

  /** Datos de la empresa (encabezado del documento): nombre, NIT, correo, logo */
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

  // ─── Internos ─────────────────────────────────────────────────────────

  private pickItemPrice(item: any): number {
    if (Array.isArray(item?.price)) {
      return num(item.price[0]?.price);
    }
    if (typeof item?.price === 'object' && item?.price !== null) {
      return num(item.price.price);
    }
    return num(item?.price);
  }

  private async findCached(store: string, billId: string): Promise<Bill | null> {
    return this.billRepository
      .createQueryBuilder('bill')
      .where('bill.store = :store', { store })
      .andWhere("bill.data->>'id' = :billId", { billId: String(billId) })
      .getOne();
  }

  private async persist(store: string, billData: any): Promise<void> {
    if (!billData?.id) return;

    try {
      const existing = await this.billRepository.findOne({ where: { id: billData.id, store } });
      if (existing) {
        existing.data = billData;
        existing.date = billData.date ? new Date(billData.date) : null;
        await this.billRepository.save(existing);
      } else {
        const bill = new Bill();
        bill.id = billData.id;
        bill.store = store;
        bill.data = billData;
        bill.datetime = null;
        bill.date = billData.date ? new Date(billData.date) : null;
        await this.billRepository.save(bill);
      }
    } catch (error) {
      this.logger.warn(`No se pudo persistir la compra ${billData.id} de ${store}: ${error.message}`);
    }
  }

  /** Whitelist de lo editable: nada del body del cliente llega crudo a Alegra */
  private buildUpdateBody(payload: BillUpdatePayload): any {
    const body: any = {};

    if (payload.date) body.date = payload.date;
    if (payload.dueDate) body.dueDate = payload.dueDate;
    if (payload.provider !== undefined && payload.provider !== null && payload.provider !== '') {
      body.provider = { id: payload.provider };
    }
    if (payload.warehouse !== undefined && payload.warehouse !== null && payload.warehouse !== '') {
      body.warehouse = { id: payload.warehouse };
    }
    if (payload.numberTemplate?.number !== undefined && payload.numberTemplate?.number !== null && `${payload.numberTemplate.number}` !== '') {
      body.numberTemplate = { number: `${payload.numberTemplate.number}` };
    }
    if (payload.observations !== undefined) body.observations = payload.observations ?? '';
    if (payload.termsConditions !== undefined) body.termsConditions = payload.termsConditions ?? '';

    if (Array.isArray(payload.items)) {
      body.purchases = {
        items: payload.items.map((item) => {
          const line: any = {
            price: num(item.price),
            quantity: num(item.quantity) || 1,
            discount: num(item.discount),
          };
          if (item.id !== undefined && item.id !== null && `${item.id}` !== '') line.id = item.id;
          if (item.observations !== undefined) line.observations = item.observations ?? '';
          if (item.description !== undefined) line.description = item.description ?? '';
          if (Array.isArray(item.tax) && item.tax.length > 0) {
            line.tax = item.tax.filter((t) => t?.id !== undefined && t?.id !== null && `${t.id}` !== '').map((t) => ({ id: t.id }));
          } else {
            line.tax = [];
          }
          return line;
        }),
      };
    }

    return body;
  }

  /** Aplana la respuesta de Alegra a la forma que consume la vista de detalle */
  private normalize(store: string, raw: any): any {
    const items = (raw?.purchases?.items || raw?.items || []).map((item: any) => {
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
        name: item.name || item.description || 'Sin concepto',
        description: item.description || '',
        observations: item.observations || '',
        reference: item.reference || '',
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
    const debitNotes = (raw?.debitNotes || raw?.debitnotes || []).map((n: any) => ({
      id: n.id,
      number: n.number || n.numberTemplate?.number || '',
      date: n.date || null,
      amount: num(n.amount ?? n.total),
    }));

    const total = num(raw?.total ?? netSubtotal);
    const retained = num(raw?.totalRetention) || retentions.reduce((acc: number, r: any) => acc + r.amount, 0);
    const debitNotesTotal = debitNotes.reduce((acc: number, n: any) => acc + n.amount, 0);
    const paid = num(raw?.totalPaid ?? raw?.paid);
    const balance = raw?.balance !== undefined && raw?.balance !== null ? num(raw.balance) : total - retained - paid;

    return {
      id: raw?.id,
      store,
      storeDisplayName: this.storeCredentialsService.getStoreDisplayName(store),
      number: raw?.numberTemplate?.number ?? raw?.number ?? raw?.id,
      fullNumber: raw?.numberTemplate?.fullNumber || raw?.numberTemplate?.number || raw?.number || '',
      date: raw?.date || null,
      dueDate: raw?.dueDate || null,
      status: raw?.status || 'open',
      // Alegra guarda dos campos distintos: `observations` son las notas del
      // documento y `anotation` la anotación interna. Se exponen por separado
      // para que la edición de "Notas" no sobrescriba la anotación.
      observations: raw?.observations || '',
      anotation: raw?.anotation || '',
      termsConditions: raw?.termsConditions || '',
      provider: {
        id: raw?.provider?.id ?? null,
        name: raw?.provider?.name || 'Desconocido',
        identification: raw?.provider?.identification || '',
        phone: raw?.provider?.phonePrimary || raw?.provider?.phone || raw?.provider?.mobile || '',
        email: raw?.provider?.email || '',
      },
      warehouse: raw?.warehouse ? { id: raw.warehouse.id, name: raw.warehouse.name } : null,
      currency: raw?.currency?.code || 'COP',
      items,
      retentions,
      debitNotes,
      payments: (raw?.payments || []).map((p: any) => ({
        id: p.id,
        date: p.date || null,
        amount: num(p.amount ?? p.total),
        paymentMethod: p.paymentMethod || p.bankAccount?.name || '',
        observations: p.observations || '',
        status: p.status || '',
      })),
      totals: {
        grossSubtotal,
        discount: discountTotal,
        netSubtotal,
        tax: Math.max(0, total - netSubtotal),
        total,
        retained,
        debitNotes: debitNotesTotal,
        paid,
        balance,
      },
    };
  }
}
