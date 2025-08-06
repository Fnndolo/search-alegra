import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AxiosResponse } from 'axios';

@Injectable()
export class InvoicesService {
  private readonly limit = 30;
  private readonly logger = new Logger(InvoicesService.name);

  private invoicesCache: any[] = [];
  private updating = false;
  private progress = 0;
  private lastInvoiceDatetime: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    this.logger.log('Descargando facturas al iniciar...');
    this.updating = true;
    this.fetchAllInvoices()
      .then((invoices) => {
        this.invoicesCache = invoices;
        this.progress = invoices.length;
        if (invoices.length > 0) {
          this.lastInvoiceDatetime = invoices[0].datetime;
        }
        this.logger.log(
          `Descarga inicial completada. Facturas en cache: ${this.invoicesCache.length}`,
        );
      })
      .catch((error) => {
        this.logger.error('Error en la descarga inicial', error);
      })
      .finally(() => {
        this.updating = false;
      });
  }

  /**
   * Obtiene todas las facturas.
   * @returns Un array de todas las facturas.
   */
  async fetchAllInvoices(): Promise<any[]> {
    let allInvoices: any[] = [];
    let start = 0;
    let total = 0;
    let firstBatch;

    const apiUrl = this.configService.get<string>('ALEGRA_API_URL') as string;
    const apiKey = this.configService.get<string>('ALEGRA_API_KEY') as string;

    this.progress = 0;
    try {
      firstBatch = await axios.get(apiUrl, {
        params: {
          start: 0,
          limit: this.limit,
          metadata: true,
          order_direction: 'DESC',
        },
        headers: {
          Authorization: `Basic ${Buffer.from(apiKey).toString('base64')}`,
        },
      });
      total = firstBatch.data.metadata?.total || 0;
      allInvoices = firstBatch.data.data || [];
      this.progress = allInvoices.length;
    } catch (error) {
      this.logger.error('Error fetching first batch', error);
      throw new ServiceUnavailableException('No se pudo conectar a Alegra');
    }

    const batchRequests: Promise<AxiosResponse<any>>[] = [];
    for (start = this.limit; start < total; start += this.limit) {
      batchRequests.push(
        axios.get(apiUrl, {
          params: {
            start,
            limit: this.limit,
            metadata: false,
            order_direction: 'DESC',
          },
          headers: {
            Authorization: `Basic ${Buffer.from(apiKey).toString('base64')}`,
          },
        }),
      );
      if (batchRequests.length === 3 || start + this.limit >= total) {
        try {
          const results = await Promise.all(batchRequests);
          results.forEach((batch) => {
            allInvoices = allInvoices.concat(batch.data.data || []);
            this.progress = allInvoices.length;
          });
        } catch (error) {
          this.logger.warn(`Error fetching batch at start=${start}`, error);
          throw new ServiceUnavailableException('Error al obtener facturas');
        }
        batchRequests.length = 0;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    return allInvoices;
  }

  /**
   * Descarga facturas nuevas desde la última fecha registrada.
   * @returns - Un array de facturas nuevas.
   */

  async fetchNewInvoices(): Promise<any[]> {
  if (!this.lastInvoiceDatetime) return [];
  let newInvoices: any[] = [];
  let start = 0;
  let total = 0;
  let keepFetching = true;
  let lastDate = this.lastInvoiceDatetime.split(' ')[0];

  const apiUrl = this.configService.get<string>('ALEGRA_API_URL') as string;
  const apiKey = this.configService.get<string>('ALEGRA_API_KEY') as string;

  // 1. Trae facturas de días posteriores (date_after)
  while (keepFetching) {
    try {
      const response = await axios.get(apiUrl, {
        params: {
          start: 0,
          limit: this.limit,
          metadata: true,
          order_direction: 'DESC',
          date_after: lastDate,
        },
        headers: {
          Authorization: `Basic ${Buffer.from(apiKey).toString('base64')}`,
        },
      });
      if (start === 0) {
        total = response.data.metadata?.total || 0;
      }
      let batchInvoices = response.data.data || [];

      if (batchInvoices.length === 0) {
        keepFetching = false;
        break;
      }

      newInvoices = newInvoices.concat(batchInvoices);

      if (batchInvoices.length < this.limit || newInvoices.length >= total) {
        keepFetching = false;
      } else {
        lastDate = batchInvoices[batchInvoices.length - 1].datetime.split(' ')[0];
        start += this.limit;
      }
    } catch (error) {
      this.logger.error('Error fetching new invoices batch', error);
      keepFetching = false;
      throw new ServiceUnavailableException('Error al obtener nuevas facturas');
    }
  }

  // 2. Trae facturas del mismo día de la última factura conocida
  let sameDayInvoices: any[] = [];
  try {
    let sameDayStart = 0;
    let sameDayTotal = 0;
    let keepFetchingSameDay = true;
    while (keepFetchingSameDay) {
      const response = await axios.get(apiUrl, {
        params: {
          start: sameDayStart,
          limit: this.limit,
          metadata: sameDayStart === 0,
          order_direction: 'DESC',
          date: lastDate,
        },
        headers: {
          Authorization: `Basic ${Buffer.from(apiKey).toString('base64')}`,
        },
      });
      if (sameDayStart === 0) {
        sameDayTotal = response.data.metadata?.total || 0;
      }
      let batch = response.data.data || [];
      if (batch.length === 0) {
        keepFetchingSameDay = false;
        break;
      }
      sameDayInvoices = sameDayInvoices.concat(batch);
      if (batch.length < this.limit || sameDayInvoices.length >= sameDayTotal) {
        keepFetchingSameDay = false;
      } else {
        sameDayStart += this.limit;
      }
    }
  } catch (error) {
    this.logger.warn('Error fetching same day invoices', error);
  }

  // Filtra solo las facturas del mismo día con datetime mayor a la última conocida
  const trulyNewSameDay = sameDayInvoices.filter(
    (inv) =>
      inv.datetime &&
      this.lastInvoiceDatetime &&
      inv.datetime > this.lastInvoiceDatetime
  );

  // Une ambas listas y elimina duplicados por id
  const allNew = [...newInvoices, ...trulyNewSameDay].filter(
    (inv, idx, arr) => arr.findIndex(i => i.id === inv.id) === idx
  );

  return allNew;
}

  /**
   * Actualiza las facturas manualmente.
   */
  async updateInvoicesManually() {
    this.updating = true;
    const newInvoices = await this.fetchNewInvoices();
    if (newInvoices.length > 0) {
      this.invoicesCache = [...newInvoices, ...this.invoicesCache];
      this.progress = this.invoicesCache.length;
      this.lastInvoiceDatetime = newInvoices[0].datetime;
      this.logger.log(
        `Nuevas facturas agregadas manualmente: ${newInvoices.length}`,
      );
    } else {
      this.logger.log('No se encontraron nuevas facturas (manual).');
    }
    this.updating = false;
  }

  /**
   * Obtiene las facturas en caché.
   * @returns Un objeto con el estado de actualización, el progreso y los datos de las facturas.
   */
  getCachedInvoices(): { updating: boolean; progress: number; data: any[] } {
    return {
      updating: this.updating,
      progress: this.progress,
      data: this.invoicesCache,
    };
  }
}
