import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formato de moneda colombiano: `$ 1.179.000`.
 * Los documentos de Alegra se leen así, con punto de miles y sin decimales
 * salvo que el valor los tenga (precios unitarios con fracción).
 */
@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  transform(value: number | string | null | undefined, decimals?: number): string {
    const amount = typeof value === 'string' ? parseFloat(value) : value;
    if (amount === null || amount === undefined || !Number.isFinite(amount)) {
      return '$ 0';
    }

    const fractionDigits = decimals ?? (Number.isInteger(amount) ? 0 : 2);
    const formatted = new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);

    return `$ ${formatted}`;
  }
}
