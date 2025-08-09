import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AxiosResponse } from 'axios';
import { StoreCredentialsService, StoreCredentials } from '../shared/store-credentials.service';

interface StoreCache {
  invoicesCache: any[];
  updating: boolean;
  fullyLoaded: boolean;
  progress: number;
  lastInvoiceDatetime: string | null;
}

@Injectable()
export class InvoicesService {
  private readonly limit = 30;
  private readonly logger = new Logger(InvoicesService.name);

  // Cache por tienda
  private storeCaches: Map<string, StoreCache> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly storeCredentialsService: StoreCredentialsService,
  ) {}

  private getStoreCache(store: string): StoreCache {
    if (!this.storeCaches.has(store)) {
      this.storeCaches.set(store, {
        invoicesCache: [],
        updating: false,
        fullyLoaded: false,
        progress: 0,
        lastInvoiceDatetime: null,
      });
    }
    return this.storeCaches.get(store)!;
  }

  /**
   * Inicializa los datos para una tienda específica si no están cargados
   */
  private async initializeStoreIfNeeded(store: string): Promise<void> {
    const storeCache = this.getStoreCache(store);
    
    if (storeCache.invoicesCache.length === 0 && !storeCache.updating) {
      this.logger.log(`Inicializando datos para tienda: ${this.storeCredentialsService.getStoreDisplayName(store)}`);
      await this.loadInitialInvoicesForStore(store);
    }
  }

  /**
   * Carga las primeras facturas para una tienda específica
   */
  private async loadInitialInvoicesForStore(store: string): Promise<void> {
    const storeCache = this.getStoreCache(store);
    storeCache.updating = true;
    
    try {
      const initialInvoices = await this.fetchInitialInvoices(store);
      storeCache.invoicesCache = initialInvoices;
      storeCache.progress = initialInvoices.length;
      
      if (initialInvoices.length > 0) {
        storeCache.lastInvoiceDatetime = initialInvoices[0].datetime;
      }
      
      this.logger.log(
        `Facturas iniciales cargadas para ${this.storeCredentialsService.getStoreDisplayName(store)}: ${storeCache.invoicesCache.length}`,
      );
      
      storeCache.updating = false;
      
      // Continuar descargando el resto en segundo plano
      this.continueLoadingInBackground(store);
      
    } catch (error) {
      this.logger.error(`Error en la carga inicial para ${store}`, error);
      storeCache.updating = false;
    }
  }

  /**
   * Carga solo las primeras facturas para mostrar inmediatamente.
   * @returns Un array con las primeras facturas.
   */
  async fetchInitialInvoices(store: string): Promise<any[]> {
    const credentials = this.storeCredentialsService.getCredentials(store);

    try {
      const response = await axios.get(credentials.invoicesApiUrl, {
        params: {
          start: 0,
          limit: this.limit,
          metadata: true,
          order_direction: 'DESC',
        },
        headers: {
          Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`,
        },
      });

      const invoices = response.data.data || [];
      // Ordenar por fecha de manera descendente (más recientes primero)
      return invoices.sort((a, b) => {
        const dateA = new Date(a.datetime || a.date);
        const dateB = new Date(b.datetime || b.date);
        return dateB.getTime() - dateA.getTime();
      });
    } catch (error) {
      this.logger.error(`Error fetching initial invoices for ${store}`, error);
      throw new ServiceUnavailableException(`No se pudo conectar a Alegra para ${store}`);
    }
  }

  /**
   * Continúa cargando las facturas restantes en segundo plano.
   */
  private async continueLoadingInBackground(store: string): Promise<void> {
    const credentials = this.storeCredentialsService.getCredentials(store);
    const storeCache = this.getStoreCache(store);
    
    try {
      // Obtener el total de facturas
      const metadataResponse = await axios.get(credentials.invoicesApiUrl, {
        params: {
          start: 0,
          limit: 1,
          metadata: true,
          order_direction: 'DESC',
        },
        headers: {
          Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`,
        },
      });

      const total = metadataResponse.data.metadata?.total || 0;
      const alreadyLoaded = storeCache.invoicesCache.length;
      
      if (alreadyLoaded >= total) {
        storeCache.updating = false;
        storeCache.fullyLoaded = true;
        this.logger.log(`Todas las facturas ya están cargadas para ${store}`);
        return;
      }

      this.logger.log(`Continuando carga en segundo plano para ${store}. ${alreadyLoaded}/${total} facturas`);

      // Cargar el resto de facturas en lotes
      let start = alreadyLoaded;
      const batchRequests: Promise<AxiosResponse<any>>[] = [];

      for (start = alreadyLoaded; start < total; start += this.limit) {
        batchRequests.push(
          axios.get(credentials.invoicesApiUrl, {
            params: {
              start,
              limit: this.limit,
              metadata: false,
              order_direction: 'DESC',
            },
            headers: {
              Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`,
            },
          }),
        );

        // Procesar en lotes de 3 requests
        if (batchRequests.length === 3 || start + this.limit >= total) {
          try {
            const results = await Promise.all(batchRequests);
            let newInvoices: any[] = [];
            
            results.forEach((batch) => {
              newInvoices = newInvoices.concat(batch.data.data || []);
            });

            if (newInvoices.length > 0) {
              // Ordenar las nuevas facturas por fecha descendente antes de agregarlas
              newInvoices.sort((a, b) => {
                const dateA = new Date(a.datetime || a.date);
                const dateB = new Date(b.datetime || b.date);
                return dateB.getTime() - dateA.getTime();
              });
            }

            // Agregar las nuevas facturas al final de la caché
            storeCache.invoicesCache = storeCache.invoicesCache.concat(newInvoices);
            storeCache.progress = storeCache.invoicesCache.length;

            this.logger.log(`Progreso de carga ${store}: ${storeCache.progress}/${total} facturas`);

          } catch (error) {
            this.logger.warn(`Error fetching background batch for ${store} at start=${start}`, error);
          }

          batchRequests.length = 0;
          // Pausa entre lotes para no sobrecargar la API
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      // Ordenar toda la caché al final para garantizar orden correcto
      storeCache.invoicesCache.sort((a, b) => {
        const dateA = new Date(a.datetime || a.date);
        const dateB = new Date(b.datetime || b.date);
        return dateB.getTime() - dateA.getTime();
      });

      storeCache.updating = false;
      storeCache.fullyLoaded = true;
      this.logger.log(`Carga completa finalizada para ${store}. Total: ${storeCache.invoicesCache.length} facturas`);

    } catch (error) {
      this.logger.error(`Error en la carga en segundo plano para ${store}`, error);
      storeCache.updating = false;
      storeCache.fullyLoaded = false;
    }
  }

  /**
   * Obtiene todas las facturas para una tienda específica.
   * @returns Un array de todas las facturas.
   */
  async fetchAllInvoices(store: string): Promise<any[]> {
    const credentials = this.storeCredentialsService.getCredentials(store);
    const storeCache = this.getStoreCache(store);
    
    let allInvoices: any[] = [];
    let start = 0;
    let total = 0;
    let firstBatch;

    storeCache.progress = 0;
    try {
      firstBatch = await axios.get(credentials.invoicesApiUrl, {
        params: {
          start: 0,
          limit: this.limit,
          metadata: true,
          order_direction: 'DESC',
        },
        headers: {
          Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`,
        },
      });
      total = firstBatch.data.metadata?.total || 0;
      allInvoices = firstBatch.data.data || [];
      storeCache.progress = allInvoices.length;
    } catch (error) {
      this.logger.error(`Error fetching first batch for ${store}`, error);
      throw new ServiceUnavailableException(`No se pudo conectar a Alegra para ${store}`);
    }

    const batchRequests: Promise<AxiosResponse<any>>[] = [];
    for (start = this.limit; start < total; start += this.limit) {
      batchRequests.push(
        axios.get(credentials.invoicesApiUrl, {
          params: {
            start,
            limit: this.limit,
            metadata: false,
            order_direction: 'DESC',
          },
          headers: {
            Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`,
          },
        }),
      );
      if (batchRequests.length === 3 || start + this.limit >= total) {
        try {
          const results = await Promise.all(batchRequests);
          results.forEach((batch) => {
            allInvoices = allInvoices.concat(batch.data.data || []);
            storeCache.progress = allInvoices.length;
          });
        } catch (error) {
          this.logger.warn(`Error fetching batch for ${store} at start=${start}`, error);
          throw new ServiceUnavailableException(`Error al obtener facturas para ${store}`);
        }
        batchRequests.length = 0;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    // Ordenar todas las facturas por fecha descendente antes de retornar
    allInvoices.sort((a, b) => {
      const dateA = new Date(a.datetime || a.date);
      const dateB = new Date(b.datetime || b.date);
      return dateB.getTime() - dateA.getTime();
    });

    return allInvoices;
  }

  /**
   * Descarga facturas nuevas desde la última fecha registrada.
   * @returns - Un array de facturas nuevas.
   */
  async fetchNewInvoices(store: string): Promise<any[]> {
    const credentials = this.storeCredentialsService.getCredentials(store);
    const storeCache = this.getStoreCache(store);
    
    if (!storeCache.lastInvoiceDatetime) return [];
    let newInvoices: any[] = [];
    let start = 0;
    let total = 0;
    let keepFetching = true;
    let lastDate = storeCache.lastInvoiceDatetime.split(' ')[0];

    // 1. Trae facturas de días posteriores (date_after)
    while (keepFetching) {
      try {
        const response = await axios.get(credentials.invoicesApiUrl, {
          params: {
            start: 0,
            limit: this.limit,
            metadata: true,
            order_direction: 'DESC',
            date_after: lastDate,
          },
          headers: {
            Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`,
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
        this.logger.error(`Error fetching new invoices batch for ${store}`, error);
        keepFetching = false;
        throw new ServiceUnavailableException(`Error al obtener nuevas facturas para ${store}`);
      }
    }

    // 2. Trae facturas del mismo día de la última factura conocida
    let sameDayInvoices: any[] = [];
    try {
      let sameDayStart = 0;
      let sameDayTotal = 0;
      let keepFetchingSameDay = true;
      while (keepFetchingSameDay) {
        const response = await axios.get(credentials.invoicesApiUrl, {
          params: {
            start: sameDayStart,
            limit: this.limit,
            metadata: sameDayStart === 0,
            order_direction: 'DESC',
            date: lastDate,
          },
          headers: {
            Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`,
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
      this.logger.warn(`Error fetching same day invoices for ${store}`, error);
    }

    // Filtra solo las facturas del mismo día con datetime mayor a la última conocida
    const trulyNewSameDay = sameDayInvoices.filter(
      (inv) =>
        inv.datetime &&
        storeCache.lastInvoiceDatetime &&
        inv.datetime > storeCache.lastInvoiceDatetime
    );

    // Une ambas listas y elimina duplicados por id
    const allNew = [...newInvoices, ...trulyNewSameDay].filter(
      (inv, idx, arr) => arr.findIndex(i => i.id === inv.id) === idx
    );

    // Ordenar las nuevas facturas por fecha descendente
    allNew.sort((a, b) => {
      const dateA = new Date(a.datetime || a.date);
      const dateB = new Date(b.datetime || b.date);
      return dateB.getTime() - dateA.getTime();
    });

    return allNew;
  }

  /**
   * Actualiza las facturas manualmente para una tienda específica.
   */
  async updateInvoicesManually(store: string) {
    const storeCache = this.getStoreCache(store);
    storeCache.updating = true;
    const newInvoices = await this.fetchNewInvoices(store);
    if (newInvoices.length > 0) {
      storeCache.invoicesCache = [...newInvoices, ...storeCache.invoicesCache];
      // Reordenar toda la caché después de agregar las nuevas facturas
      storeCache.invoicesCache.sort((a, b) => {
        const dateA = new Date(a.datetime || a.date);
        const dateB = new Date(b.datetime || b.date);
        return dateB.getTime() - dateA.getTime();
      });
      storeCache.progress = storeCache.invoicesCache.length;
      storeCache.lastInvoiceDatetime = newInvoices[0].datetime;
      this.logger.log(
        `Nuevas facturas agregadas manualmente para ${store}: ${newInvoices.length}`,
      );
    } else {
      this.logger.log(`No se encontraron nuevas facturas para ${store} (manual).`);
    }
    storeCache.updating = false;
  }

  /**
   * Obtiene las facturas en caché para una tienda específica.
   * @returns Un objeto con el estado de actualización, el progreso, si la carga está completa y los datos de las facturas.
   */
  async getCachedInvoices(store: string): Promise<{ updating: boolean; progress: number; fullyLoaded: boolean; data: any[]; store: string; storeDisplayName: string }> {
    // Validar que la tienda sea válida
    this.storeCredentialsService.getCredentials(store); // Esto lanzará error si la tienda es inválida
    
    // Inicializar datos si es necesario
    await this.initializeStoreIfNeeded(store);
    
    const storeCache = this.getStoreCache(store);
    
    return {
      updating: storeCache.updating,
      progress: storeCache.progress,
      fullyLoaded: storeCache.fullyLoaded,
      data: storeCache.invoicesCache,
      store: store,
      storeDisplayName: this.storeCredentialsService.getStoreDisplayName(store),
    };
  }
}
