import { parseCaseMessage } from './chat-message.parser';

describe('parseCaseMessage', () => {
  it('acepta el formato acordado', () => {
    expect(parseCaseMessage('@SmartAlegra compra 1280 medellin')).toEqual({
      ok: true,
      store: 'medellin',
      billNumber: '1280',
    });
  });

  it('acepta el texto sin la mención (argumentText de Chat)', () => {
    expect(parseCaseMessage('compra 6214 pasto')).toMatchObject({ ok: true, store: 'pasto', billNumber: '6214' });
  });

  it('tolera tildes, mayúsculas y orden invertido', () => {
    expect(parseCaseMessage('@Bot COMPRA Medellín 1280')).toMatchObject({ ok: true, store: 'medellin', billNumber: '1280' });
    expect(parseCaseMessage('@Bot compra 99 BOGOTÁ')).toMatchObject({ ok: true, store: 'bogota', billNumber: '99' });
  });

  it('tolera el numeral y la puntuación', () => {
    expect(parseCaseMessage('@Bot compra #1280, medellin')).toMatchObject({ ok: true, store: 'medellin', billNumber: '1280' });
  });

  it('acepta alias comunes de sede', () => {
    expect(parseCaseMessage('@Bot compra 5 medallo')).toMatchObject({ ok: true, store: 'medellin' });
    expect(parseCaseMessage('@Bot compra 5 bta')).toMatchObject({ ok: true, store: 'bogota' });
  });

  it('ignora otras menciones del mensaje', () => {
    expect(parseCaseMessage('@Bot compra 1280 medellin @ANDRES VALLEJOS')).toMatchObject({
      ok: true,
      billNumber: '1280',
      store: 'medellin',
    });
  });

  it('rechaza si falta la palabra compra, para no abrir casos de ventas', () => {
    const r = parseCaseMessage('@Bot venta 3195 medellin');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('compra');
  });

  it('rechaza si falta la sede, porque los números se repiten entre sedes', () => {
    const r = parseCaseMessage('@Bot compra 1280');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('sede');
  });

  it('rechaza si falta el número', () => {
    const r = parseCaseMessage('@Bot compra medellin');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('número');
  });

  it('rechaza mensajes vacíos o que solo traen la mención', () => {
    expect(parseCaseMessage('').ok).toBe(false);
    expect(parseCaseMessage('@Bot').ok).toBe(false);
  });

  it('no confunde los textos libres que ya usa el equipo', () => {
    expect(parseCaseMessage('Corregir factura de compra').ok).toBe(false);
    expect(parseCaseMessage('LIBRE PARA INVENTARIO').ok).toBe(false);
    expect(parseCaseMessage('ANULAR FACTURA').ok).toBe(false);
  });
});
