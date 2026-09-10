import { InvoicesDetailService } from './invoices-detail.service';

describe('InvoicesDetailService', () => {
  const storeCredentials = { getStoreDisplayName: (s: string) => `Smart Gadgets ${s}` } as any;
  const invoiceRepository = { createQueryBuilder: jest.fn() } as any;

  const build = (alegraGet: jest.Mock) =>
    new InvoicesDetailService({ get: alegraGet } as any, storeCredentials, invoiceRepository);

  // Respuesta representativa de GET /invoices/{id} (la venta 29299 de las capturas)
  const rawInvoice = {
    id: '29299',
    date: '2026-08-28',
    dueDate: '2026-08-28',
    status: 'closed',
    paymentForm: 'CASH',
    observations: 'ADDI',
    anotation: '',
    numberTemplate: { number: '29299' },
    client: { id: 12, name: 'JOHN JAIRO MONTOYA BETANCUR', identification: '6321123', phonePrimary: '316 437 0276' },
    seller: { id: 4, name: 'INGRID TATIANA GOMEZ DELGADO' },
    priceList: { id: 1, name: 'General' },
    warehouse: { id: 1, name: 'Principal' },
    items: [
      {
        id: 300,
        name: 'SAMSUNG GALAXY A37 5G 256GB -RAM 8GB',
        price: 1179000,
        quantity: 1,
        discount: 0,
        description: '358817302231860',
        tax: [],
        total: 1179000,
      },
    ],
    total: 1179000,
    totalPaid: 1179000,
    balance: 0,
    payments: [{ id: 27128, date: '2026-08-28', amount: 1179000 }],
  };

  it('aplana la venta con los totales de la cabecera', () => {
    const service = build(jest.fn());
    const doc = (service as any).normalize('pasto', rawInvoice, []);

    expect(doc.number).toBe('29299');
    expect(doc.client.name).toBe('JOHN JAIRO MONTOYA BETANCUR');
    expect(doc.seller.name).toBe('INGRID TATIANA GOMEZ DELGADO');
    expect(doc.priceList.name).toBe('General');
    expect(doc.warehouse.name).toBe('Principal');
    expect(doc.items[0].description).toBe('358817302231860');
    expect(doc.totals).toMatchObject({
      grossSubtotal: 1179000,
      discount: 0,
      netSubtotal: 1179000,
      total: 1179000,
      retained: 0,
      collected: 1179000,
      balance: 0,
    });
  });

  it('completa cada pago con el detalle de /payments', async () => {
    const alegraGet = jest.fn().mockResolvedValue({
      id: 27128,
      number: 27128,
      date: '2026-08-28',
      status: 'open',
      paymentMethod: 'Transfer',
      observations: '',
    });
    const service = build(alegraGet);

    const payments = await (service as any).enrichPayments('pasto', rawInvoice.payments, []);

    expect(alegraGet).toHaveBeenCalledWith('pasto', '/payments/27128');
    expect(payments[0]).toMatchObject({
      id: 27128,
      number: 27128,
      status: 'open',
      paymentMethod: 'Transfer',
      amount: 1179000,
    });
  });

  it('cae al banco ya cacheado cuando /payments falla', async () => {
    const alegraGet = jest.fn().mockRejectedValue(new Error('503'));
    const service = build(alegraGet);

    const payments = await (service as any).enrichPayments('pasto', rawInvoice.payments, [
      { paymentId: '27128', bankName: 'Bancolombia', amount: 1179000 },
    ]);

    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      id: 27128,
      bankAccount: 'Bancolombia',
      paymentMethod: 'Bancolombia',
      amount: 1179000,
    });
  });

  it('mantiene separadas las notas y la anotación interna', () => {
    const service = build(jest.fn());
    const doc = (service as any).normalize('pasto', { ...rawInvoice, anotation: 'Nota interna' }, []);

    expect(doc.observations).toBe('ADDI');
    expect(doc.anotation).toBe('Nota interna');
  });
});
