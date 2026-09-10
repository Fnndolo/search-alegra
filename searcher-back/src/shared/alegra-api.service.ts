import { Injectable, Logger, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import axios, { AxiosRequestConfig, Method } from 'axios';
import { StoreCredentialsService } from './store-credentials.service';

/**
 * Cliente genérico para la API de Alegra por tienda.
 *
 * Los servicios existentes (invoices/bills) arman la URL a mano a partir de
 * `invoicesApiUrl` / `billsApiUrl`. Para todo lo demás (contactos, ítems,
 * bodegas, impuestos, pagos, empresa) hace falta la base de la API, que se
 * deriva de esas mismas URLs para no depender de variables de entorno nuevas.
 */
@Injectable()
export class AlegraApiService {
  private readonly logger = new Logger(AlegraApiService.name);
  private readonly maxRetries = 3;
  private readonly baseDelay = 1000;
  private readonly defaultBase = 'https://api.alegra.com/api/v1';

  constructor(private readonly storeCredentialsService: StoreCredentialsService) {}

  /** Base de la API (…/api/v1) derivada de las URLs configuradas por tienda */
  getApiBase(store: string): string {
    const credentials = this.storeCredentialsService.getCredentials(store);
    const source = credentials.invoicesApiUrl || credentials.billsApiUrl || '';
    const base = source.replace(/\/(invoices|bills)\/?$/i, '').replace(/\/$/, '');
    return base || this.defaultBase;
  }

  private getAuthHeader(store: string): string {
    const credentials = this.storeCredentialsService.getCredentials(store);
    return `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`;
  }

  private async requestWithRetry(config: AxiosRequestConfig, retryCount = 0): Promise<any> {
    try {
      return await axios(config);
    } catch (error: any) {
      const status = error?.response?.status ?? error?.status;
      if (status === 429 && retryCount < this.maxRetries) {
        const delay = this.baseDelay * Math.pow(2, retryCount);
        this.logger.warn(`Rate limit de Alegra. Reintentando en ${delay}ms (intento ${retryCount + 1}/${this.maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.requestWithRetry(config, retryCount + 1);
      }
      throw error;
    }
  }

  /**
   * Ejecuta una petición contra la API de Alegra usando las credenciales de la tienda.
   * `path` es relativo a la base (p.ej. `/contacts`, `/bills/123`).
   */
  async request<T = any>(
    store: string,
    method: Method,
    path: string,
    options: { params?: Record<string, any>; data?: any } = {},
  ): Promise<T> {
    const url = `${this.getApiBase(store)}${path.startsWith('/') ? path : `/${path}`}`;

    try {
      const response = await this.requestWithRetry({
        url,
        method,
        params: options.params,
        data: options.data,
        headers: {
          Authorization: this.getAuthHeader(store),
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });
      return response.data as T;
    } catch (error: any) {
      const status = error?.response?.status;
      const payload = error?.response?.data;
      const detail =
        payload?.message ||
        payload?.error ||
        (Array.isArray(payload?.errors) ? payload.errors.map((e: any) => e?.message || e).join(', ') : null) ||
        error?.message;

      this.logger.error(
        `Alegra ${String(method).toUpperCase()} ${url} falló` +
          (status ? ` | HTTP ${status}` : '') +
          (payload ? ` | ${JSON.stringify(payload).slice(0, 400)}` : ''),
      );

      // 4xx = el problema viene de los datos enviados: se devuelve tal cual al front
      if (status && status >= 400 && status < 500) {
        throw new BadRequestException(detail || `Alegra rechazó la petición (HTTP ${status})`);
      }
      throw new ServiceUnavailableException(`Error comunicándose con Alegra: ${detail}`);
    }
  }

  get<T = any>(store: string, path: string, params?: Record<string, any>): Promise<T> {
    return this.request<T>(store, 'GET', path, { params });
  }

  put<T = any>(store: string, path: string, data: any): Promise<T> {
    return this.request<T>(store, 'PUT', path, { data });
  }

  post<T = any>(store: string, path: string, data: any): Promise<T> {
    return this.request<T>(store, 'POST', path, { data });
  }
}
