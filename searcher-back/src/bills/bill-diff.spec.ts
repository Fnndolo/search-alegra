import { diffBill } from './bill-diff';

const doc = (overrides: any = {}) => ({
  number: '1280',
  date: '2024-10-28',
  dueDate: '2024-10-28',
  provider: { name: 'ALFET STORE MEDELLIN' },
  warehouse: { name: 'Principal' },
  observations: '',
  termsConditions: '',
  totals: { total: 6000000 },
  items: [
    { name: 'REDMI NOTE 13 PRO PLUS 5G 512GB', quantity: 4, price: 1500000, discount: 0, observations: 'IMEI 123' },
  ],
  ...overrides,
});

describe('diffBill', () => {
  it('no reporta nada si no cambió nada', () => {
    expect(diffBill(doc(), doc())).toEqual([]);
  });

  it('detecta el cambio de proveedor', () => {
    const changes = diffBill(doc(), doc({ provider: { name: 'OTRO PROVEEDOR' } }));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      field: 'provider',
      label: 'Proveedor',
      before: 'ALFET STORE MEDELLIN',
      after: 'OTRO PROVEEDOR',
    });
  });

  it('detecta cambios en una línea y los describe de forma legible', () => {
    const after = doc({
      items: [{ name: 'REDMI NOTE 13 PRO PLUS 5G 512GB', quantity: 2, price: 1500000, discount: 0, observations: 'IMEI 123' }],
      totals: { total: 3000000 },
    });
    const changes = diffBill(doc(), after);

    const linea = changes.find((c) => c.field === 'items[0]');
    expect(linea).toBeDefined();
    expect(String(linea!.before)).toContain('cant. 4');
    expect(String(linea!.after)).toContain('cant. 2');

    const total = changes.find((c) => c.field === 'total');
    expect(total).toMatchObject({ before: '6.000.000', after: '3.000.000' });
  });

  it('reporta líneas agregadas y eliminadas', () => {
    const agregada = diffBill(
      doc(),
      doc({ items: [...doc().items, { name: 'CARGADOR', quantity: 1, price: 50000, discount: 0 }] }),
    );
    expect(agregada.some((c) => c.label.includes('agregada'))).toBe(true);

    const eliminada = diffBill(doc(), doc({ items: [] }));
    expect(eliminada.some((c) => c.label.includes('eliminada'))).toBe(true);
  });

  it('trata null, undefined y cadena vacía como el mismo valor, para no inventar cambios', () => {
    expect(diffBill(doc({ observations: '' }), doc({ observations: null }))).toEqual([]);
    expect(diffBill(doc({ warehouse: null }), doc({ warehouse: null }))).toEqual([]);
  });

  it('no confunde el número en texto con el número en entero', () => {
    expect(diffBill(doc({ number: '1280' }), doc({ number: 1280 }))).toEqual([]);
  });
});
