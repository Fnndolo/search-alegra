import { BillsDetailService } from './bills-detail.service';

/**
 * La normalización y el armado del payload son la parte frágil: traducen lo que
 * responde Alegra a lo que pinta la vista, y de vuelta. Se prueban directamente
 * sobre la instancia, sin red ni base de datos.
 */
describe('BillsDetailService', () => {
  const alegra = { get: jest.fn(), put: jest.fn(), post: jest.fn() } as any;
  const storeCredentials = { getStoreDisplayName: (s: string) => `Smart Gadgets ${s}` } as any;
  const billRepository = { findOne: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() } as any;

  const service = new BillsDetailService(alegra, storeCredentials, billRepository);
  const normalize = (raw: any) => (service as any).normalize('pasto', raw);
  const buildUpdateBody = (payload: any) => (service as any).buildUpdateBody(payload);

  // Respuesta representativa de GET /bills/{id} (la compra 6214 de las capturas)
  const rawBill = {
    id: '6214',
    date: '2026-08-28',
    dueDate: '2026-08-28',
    status: 'open',
    observations: '',
    anotation: 'Anotación interna',
    termsConditions: '',
    numberTemplate: { number: '6214', fullNumber: '6214' },
    provider: { id: 55, name: 'TMS SOLUTIONS SAS', identification: '901225891' },
    purchases: {
      items: [
        {
          id: 900,
          name: 'PORTATIL ASUS EXPERTBOOK PM1503 CDA 512 GB',
          price: 2000000,
          quantity: 1,
          discount: 0,
          observations: 'CANTIDAD INICIAL 1 *W4NXCV07X356167',
          tax: [],
          total: 2000000,
        },
      ],
    },
    total: 2000000,
    totalPaid: 0,
    balance: 2000000,
  };

  it('aplana el documento con los totales de la cabecera', () => {
    const doc = normalize(rawBill);

    expect(doc.number).toBe('6214');
    expect(doc.provider.name).toBe('TMS SOLUTIONS SAS');
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].observations).toBe('CANTIDAD INICIAL 1 *W4NXCV07X356167');
    expect(doc.totals).toMatchObject({
      grossSubtotal: 2000000,
      discount: 0,
      netSubtotal: 2000000,
      total: 2000000,
      retained: 0,
      debitNotes: 0,
      paid: 0,
      balance: 2000000,
    });
  });

  it('mantiene separadas las notas y la anotación interna', () => {
    const doc = normalize({ ...rawBill, observations: 'Notas del documento' });

    expect(doc.observations).toBe('Notas del documento');
    expect(doc.anotation).toBe('Anotación interna');
  });

  it('calcula descuento y subtotal neto por línea', () => {
    const doc = normalize({
      ...rawBill,
      total: 1800000,
      purchases: {
        items: [{ id: 900, name: 'Portátil', price: 1000000, quantity: 2, discount: 10, tax: [] }],
      },
    });

    expect(doc.totals.grossSubtotal).toBe(2000000);
    expect(doc.totals.discount).toBe(200000);
    expect(doc.totals.netSubtotal).toBe(1800000);
    expect(doc.items[0].total).toBe(1800000);
  });

  it('deriva el retenido de las retenciones cuando Alegra no manda totalRetention', () => {
    const doc = normalize({
      ...rawBill,
      retentions: [{ id: 1, name: 'Retefuente', percentage: 2.5, amount: 50000 }],
    });

    expect(doc.totals.retained).toBe(50000);
  });

  it('solo envía a Alegra los campos permitidos', () => {
    const body = buildUpdateBody({
      date: '2026-08-28',
      dueDate: '2026-09-28',
      provider: 55,
      warehouse: 3,
      numberTemplate: { number: 6215 },
      observations: 'Nuevas notas',
      termsConditions: 'Términos',
      status: 'closed', // campo no editable: debe ignorarse
      total: 99, // idem
      items: [
        { id: 900, price: '2000000', quantity: '2', discount: '5', observations: 'Serial', tax: [{ id: 7 }] },
      ],
    } as any);

    expect(body).toEqual({
      date: '2026-08-28',
      dueDate: '2026-09-28',
      provider: { id: 55 },
      warehouse: { id: 3 },
      numberTemplate: { number: '6215' },
      observations: 'Nuevas notas',
      termsConditions: 'Términos',
      purchases: {
        items: [{ id: 900, price: 2000000, quantity: 2, discount: 5, observations: 'Serial', tax: [{ id: 7 }] }],
      },
    });
    expect(body.status).toBeUndefined();
    expect(body.total).toBeUndefined();
    expect(body.anotation).toBeUndefined();
  });

  it('omite los campos que no vienen en el payload', () => {
    const body = buildUpdateBody({ date: '2026-08-28', items: [{ id: 900, price: 100, quantity: 1, discount: 0 }] });

    expect(body).not.toHaveProperty('warehouse');
    expect(body).not.toHaveProperty('numberTemplate');
    expect(body).not.toHaveProperty('provider');
    expect(body.purchases.items[0].tax).toEqual([]);
  });
});
