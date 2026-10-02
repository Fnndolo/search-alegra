import { BillFieldChange } from '../entities/bill-edit-audit.entity';

/**
 * Compara el documento antes y después de editarlo y devuelve solo lo que
 * cambió, en términos legibles para el hilo de Chat y la auditoría.
 *
 * Recibe la forma ya normalizada que devuelve BillsDetailService.
 */

const money = (value: any): string => {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return String(value ?? '');
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n);
};

const describeItem = (item: any): string => {
  const parts = [
    item?.name ?? 'sin concepto',
    `cant. ${item?.quantity ?? 0}`,
    `precio ${money(item?.price)}`,
  ];
  if (Number(item?.discount) > 0) parts.push(`desc. ${item.discount}%`);
  if (item?.observations) parts.push(`obs. "${item.observations}"`);
  return parts.join(', ');
};

const SIMPLE_FIELDS: { field: string; label: string; get: (doc: any) => any }[] = [
  { field: 'number', label: 'Número', get: (d) => d?.number },
  { field: 'date', label: 'Fecha', get: (d) => d?.date },
  { field: 'dueDate', label: 'Vencimiento', get: (d) => d?.dueDate },
  { field: 'provider', label: 'Proveedor', get: (d) => d?.provider?.name },
  { field: 'warehouse', label: 'Bodega', get: (d) => d?.warehouse?.name ?? null },
  { field: 'observations', label: 'Notas', get: (d) => d?.observations },
  { field: 'termsConditions', label: 'Términos y condiciones', get: (d) => d?.termsConditions },
  { field: 'total', label: 'Total', get: (d) => (d?.totals?.total === undefined ? undefined : money(d.totals.total)) },
];

export function diffBill(before: any, after: any): BillFieldChange[] {
  const changes: BillFieldChange[] = [];

  for (const { field, label, get } of SIMPLE_FIELDS) {
    const a = get(before);
    const b = get(after);
    // Se normaliza a texto: Alegra devuelve números y cadenas indistintamente
    const sa = a === null || a === undefined ? '' : String(a);
    const sb = b === null || b === undefined ? '' : String(b);
    if (sa !== sb) {
      changes.push({ field, label, before: a ?? null, after: b ?? null });
    }
  }

  changes.push(...diffItems(before?.items || [], after?.items || []));
  return changes;
}

/**
 * Las líneas se comparan por posición: Alegra reemplaza la lista completa en
 * cada edición, así que no hay identidad estable entre antes y después.
 */
function diffItems(before: any[], after: any[]): BillFieldChange[] {
  const changes: BillFieldChange[] = [];
  const max = Math.max(before.length, after.length);

  for (let i = 0; i < max; i++) {
    const a = before[i];
    const b = after[i];
    const label = `Línea ${i + 1}`;

    if (a && !b) {
      changes.push({ field: `items[${i}]`, label: `${label} (eliminada)`, before: describeItem(a), after: null });
      continue;
    }
    if (!a && b) {
      changes.push({ field: `items[${i}]`, label: `${label} (agregada)`, before: null, after: describeItem(b) });
      continue;
    }

    const da = describeItem(a);
    const db = describeItem(b);
    if (da !== db) {
      changes.push({ field: `items[${i}]`, label, before: da, after: db });
    }
  }

  return changes;
}
