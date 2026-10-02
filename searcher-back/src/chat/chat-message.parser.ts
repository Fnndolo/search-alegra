/**
 * Parseo del mensaje que abre un caso en Google Chat.
 *
 * Convención acordada con el equipo:
 *     @Bot compra <numero> <sede>
 *
 * La mención del bot llega como texto (`@SmartAlegra`) y además viene marcada en
 * `annotations`, pero Chat también expone `argumentText`, que es el mensaje SIN
 * la mención. Se acepta cualquiera de los dos: se limpian las menciones por si
 * llega el texto completo.
 */

export const VALID_STORES = ['pasto', 'medellin', 'armenia', 'pereira', 'bogota'] as const;
export type StoreKey = (typeof VALID_STORES)[number];

export interface ParsedCaseMessage {
  ok: boolean;
  store?: StoreKey;
  billNumber?: string;
  /** Motivo legible del rechazo, pensado para responderlo en el hilo */
  error?: string;
}

/** Quita tildes y pasa a minúsculas, para aceptar "Medellín" y "medellin" por igual */
const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Alias que la gente escribe en el chat → clave de sede del sistema */
const STORE_ALIASES: Record<string, StoreKey> = {
  pasto: 'pasto',
  medellin: 'medellin',
  medallo: 'medellin',
  armenia: 'armenia',
  pereira: 'pereira',
  bogota: 'bogota',
  bta: 'bogota',
};

const KEYWORD = 'compra';

export function parseCaseMessage(rawText: string): ParsedCaseMessage {
  if (!rawText || !rawText.trim()) {
    return { ok: false, error: 'El mensaje está vacío.' };
  }

  // Fuera las menciones (@Bot, @Persona) y los signos de puntuación sueltos
  const withoutMentions = rawText.replace(/@[^\s]+/g, ' ');
  const text = normalize(withoutMentions).replace(/[.,;:#]/g, ' ');
  const tokens = text.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return { ok: false, error: 'El mensaje no tiene contenido además de la mención.' };
  }

  if (!tokens.includes(KEYWORD)) {
    return {
      ok: false,
      error: 'Falta la palabra "compra". El formato es: `@Bot compra <numero> <sede>`.',
    };
  }

  // Primer token puramente numérico = número de factura
  const billNumber = tokens.find((t) => /^\d+$/.test(t));
  if (!billNumber) {
    return {
      ok: false,
      error: 'No encontré el número de factura. El formato es: `@Bot compra <numero> <sede>`.',
    };
  }

  const storeToken = tokens.find((t) => STORE_ALIASES[t] !== undefined);
  if (!storeToken) {
    return {
      ok: false,
      error:
        `No encontré la sede. Indique una de: ${VALID_STORES.join(', ')}. ` +
        'El formato es: `@Bot compra <numero> <sede>`.',
    };
  }

  return { ok: true, store: STORE_ALIASES[storeToken], billNumber };
}
