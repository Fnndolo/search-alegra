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
  billsCache: any[];
  updating: boolean;
  fullyLoaded: boolean;
  progress: number;
  lastBillDatetime: string | null;
}

@Injectable()
export class BillsService {
  private readonly limit = 30;
  private readonly logger = new Logger(BillsService.name);

  // Cache por tienda
  private storeCaches: Map<string, StoreCache> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly storeCredentialsService: StoreCredentialsService,
  ) {}

  private getStoreCache(store: string): StoreCache {
    if (!this.storeCaches.has(store)) {
      this.storeCaches.set(store, {
        billsCache: [],
        updating: false,
        fullyLoaded: false,
        progress: 0,
        lastBillDatetime: null,
      });
    }
    return this.storeCaches.get(store)!;
  }

  /**
   * Inicializa los datos para una tienda específica si no están cargados
   */
  private async initializeStoreIfNeeded(store: string): Promise<void> {
    const storeCache = this.getStoreCache(store);
    
    if (storeCache.billsCache.length === 0 && !storeCache.updating) {
      this.logger.log(`Inicializando bills para tienda: ${this.storeCredentialsService.getStoreDisplayName(store)}`);
      await this.loadInitialBillsForStore(store);
    }
  }

  /**
   * Carga las primeras bills para una tienda específica
   */
  private async loadInitialBillsForStore(store: string): Promise<void> {
    const storeCache = this.getStoreCache(store);
    storeCache.updating = true;
    
    try {
      const initialBills = await this.fetchInitialBills(store);
      storeCache.billsCache = initialBills;
      storeCache.progress = initialBills.length;
      
      if (initialBills.length > 0) {
        storeCache.lastBillDatetime = initialBills[0].datetime;
      }
      
      this.logger.log(
        `Bills iniciales cargadas para ${this.storeCredentialsService.getStoreDisplayName(store)}: ${storeCache.billsCache.length}`,
      );
      
      storeCache.updating = false;
      
      // Continuar descargando el resto en segundo plano
      this.continueLoadingInBackground(store);
      
    } catch (error) {
      this.logger.error(`Error en la carga inicial de bills para ${store}`, error);
      storeCache.updating = false;
    }
  }

  /**
   * Carga solo las primeras bills para mostrar inmediatamente.
   * @returns Un array con las primeras bills.
   */
  async fetchInitialBills(store: string): Promise<any[]> {
    const credentials = this.storeCredentialsService.getCredentials(store);

    try {
      const response = await axios.get(credentials.billsApiUrl, {
        params: {
          start: 0,
          limit: this.limit,
          metadata: true,
          order_direction: 'DESC',
          type: 'bill',
        },
        headers: {
          Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`,
        },
      });

      const bills = response.data.data || [];
      // Ordenar por fecha de manera descendente (más recientes primero)
      return bills.sort((a, b) => {
        const dateA = new Date(a.datetime || a.date);
        const dateB = new Date(b.datetime || b.date);
        return dateB.getTime() - dateA.getTime();
      });
    } catch (error) {
      this.logger.error(`Error fetching initial bills for ${store}`, error);
      throw new ServiceUnavailableException(`No se pudo conectar a Alegra para bills de ${store}`);
    }
  }

  /**
   * Continúa cargando las bills restantes en segundo plano.
   */
  private async continueLoadingInBackground(store: string): Promise<void> {
    const credentials = this.storeCredentialsService.getCredentials(store);
    const storeCache = this.getStoreCache(store);
    
    try {
      // Obtener el total de bills
      const metadataResponse = await axios.get(credentials.billsApiUrl, {
        params: {
          start: 0,
          limit: 1,
          metadata: true,
          order_direction: 'DESC',
          type: 'bill',
        },
        headers: {
          Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`,
        },
      });

      const total = metadataResponse.data.metadata?.total || 0;
      const alreadyLoaded = storeCache.billsCache.length;
      
      if (alreadyLoaded >= total) {
        storeCache.updating = false;
        storeCache.fullyLoaded = true;
        this.logger.log(`Todas las bills ya están cargadas para ${store}`);
        return;
      }

      this.logger.log(`Continuando carga de bills en segundo plano para ${store}. ${alreadyLoaded}/${total} bills`);

      // Cargar el resto de bills en lotes
      let start = alreadyLoaded;
      const batchRequests: Promise<AxiosResponse<any>>[] = [];

      for (start = alreadyLoaded; start < total; start += this.limit) {
        batchRequests.push(
          axios.get(credentials.billsApiUrl, {
            params: {
              start,
              limit: this.limit,
              metadata: false,
              order_direction: 'DESC',
              type: 'bill',
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
            let newBills: any[] = [];
            
            results.forEach((batch) => {
              newBills = newBills.concat(batch.data.data || []);
            });

            if (newBills.length > 0) {
              // Ordenar las nuevas bills por fecha descendente antes de agregarlas
              newBills.sort((a, b) => {
                const dateA = new Date(a.datetime || a.date);
                const dateB = new Date(b.datetime || b.date);
                return dateB.getTime() - dateA.getTime();
              });
            }

            // Agregar las nuevas bills al final de la caché
            storeCache.billsCache = storeCache.billsCache.concat(newBills);
            storeCache.progress = storeCache.billsCache.length;

            this.logger.log(`Progreso de carga bills ${store}: ${storeCache.progress}/${total} bills`);

          } catch (error) {
            this.logger.warn(`Error fetching background bills batch for ${store} at start=${start}`, error);
          }

          batchRequests.length = 0;
          // Pausa entre lotes para no sobrecargar la API
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      // Ordenar toda la caché al final para garantizar orden correcto
      storeCache.billsCache.sort((a, b) => {
        const dateA = new Date(a.datetime || a.date);
        const dateB = new Date(b.datetime || b.date);
        return dateB.getTime() - dateA.getTime();
      });

      storeCache.updating = false;
      storeCache.fullyLoaded = true;
      this.logger.log(`Carga completa de bills finalizada para ${store}. Total: ${storeCache.billsCache.length} bills`);

    } catch (error) {
      this.logger.error(`Error en la carga en segundo plano de bills para ${store}`, error);
      storeCache.updating = false;
      storeCache.fullyLoaded = false;
    }
  }

  /**
   * Obtiene todas las bills para una tienda específica.
   * @returns Un array de todas las bills.
   */
  async fetchAllBills(store: string): Promise<any[]> {
    const credentials = this.storeCredentialsService.getCredentials(store);
    const storeCache = this.getStoreCache(store);
    
    let allBills: any[] = [];
    let start = 0;
    let total = 0;
    let firstBatch;

    storeCache.progress = 0;
    try {
      firstBatch = await axios.get(credentials.billsApiUrl, {
        params: {
          start: 0,
          limit: this.limit,
          metadata: true,
          order_direction: 'DESC',
          type: 'bill',
        },
        headers: {
          Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`,
        },
      });
      total = firstBatch.data.metadata?.total || 0;
      allBills = firstBatch.data.data || [];
      storeCache.progress = allBills.length;
    } catch (error) {
      this.logger.error(`Error fetching first bills batch for ${store}`, error);
      throw new ServiceUnavailableException(`No se pudo conectar a Alegra para bills de ${store}`);
    }

    const batchRequests: Promise<AxiosResponse<any>>[] = [];
    for (start = this.limit; start < total; start += this.limit) {
      batchRequests.push(
        axios.get(credentials.billsApiUrl, {
          params: {
            start,
            limit: this.limit,
            metadata: false,
            order_direction: 'DESC',
            type: 'bill',
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
            allBills = allBills.concat(batch.data.data || []);
            storeCache.progress = allBills.length;
          });
        } catch (error) {
          this.logger.warn(`Error fetching bills batch for ${store} at start=${start}`, error);
          throw new ServiceUnavailableException(`Error al obtener bills para ${store}`);
        }
        batchRequests.length = 0;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    // Ordenar todas las bills por fecha descendente antes de retornar
    allBills.sort((a, b) => {
      const dateA = new Date(a.datetime || a.date);
      const dateB = new Date(b.datetime || b.date);
      return dateB.getTime() - dateA.getTime();
    });

    return allBills;
  }

  /**
   * Descarga bills nuevas desde la última fecha registrada.
   * @returns - Un array de bills nuevas.
   */
  async fetchNewBills(store: string): Promise<any[]> {
    const credentials = this.storeCredentialsService.getCredentials(store);
    const storeCache = this.getStoreCache(store);
    
    if (!storeCache.lastBillDatetime) return [];
    let newBills: any[] = [];
    let start = 0;
    let total = 0;
    let keepFetching = true;
    let lastDate = storeCache.lastBillDatetime.split(' ')[0];

    // 1. Trae bills de días posteriores (date_after)
    while (keepFetching) {
      try {
        const response = await axios.get(credentials.billsApiUrl, {
          params: {
            start: 0,
            limit: this.limit,
            metadata: true,
            order_direction: 'DESC',
            date_after: lastDate,
            type: 'bill',
          },
          headers: {
            Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`,
          },
        });
        if (start === 0) {
          total = response.data.metadata?.total || 0;
        }
        let batchBills = response.data.data || [];

        if (batchBills.length === 0) {
          keepFetching = false;
          break;
        }

        newBills = newBills.concat(batchBills);

        if (batchBills.length < this.limit || newBills.length >= total) {
          keepFetching = false;
        } else {
          lastDate = batchBills[batchBills.length - 1].datetime.split(' ')[0];
          start += this.limit;
        }
      } catch (error) {
        this.logger.error(`Error fetching new bills batch for ${store}`, error);
        keepFetching = false;
        throw new ServiceUnavailableException(`Error al obtener nuevas bills para ${store}`);
      }
    }

    // 2. Trae bills del mismo día de la última bill conocida
    let sameDayBills: any[] = [];
    try {
      let sameDayStart = 0;
      let sameDayTotal = 0;
      let keepFetchingSameDay = true;
      while (keepFetchingSameDay) {
        const response = await axios.get(credentials.billsApiUrl, {
          params: {
            start: sameDayStart,
            limit: this.limit,
            metadata: sameDayStart === 0,
            order_direction: 'DESC',
            date: lastDate,
            type: 'bill',
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
        sameDayBills = sameDayBills.concat(batch);
        if (batch.length < this.limit || sameDayBills.length >= sameDayTotal) {
          keepFetchingSameDay = false;
        } else {
          sameDayStart += this.limit;
        }
      }
    } catch (error) {
      this.logger.warn(`Error fetching same day bills for ${store}`, error);
    }

    // Filtra solo las bills del mismo día con datetime mayor a la última conocida
    const trulyNewSameDay = sameDayBills.filter(
      (bill) =>
        bill.datetime &&
        storeCache.lastBillDatetime &&
        bill.datetime > storeCache.lastBillDatetime
    );

    // Une ambas listas y elimina duplicados por id
    const allNew = [...newBills, ...trulyNewSameDay].filter(
      (bill, idx, arr) => arr.findIndex(b => b.id === bill.id) === idx
    );

    // Ordenar las nuevas bills por fecha descendente
    allNew.sort((a, b) => {
      const dateA = new Date(a.datetime || a.date);
      const dateB = new Date(b.datetime || b.date);
      return dateB.getTime() - dateA.getTime();
    });

    return allNew;
  }

  /**
   * Actualiza las bills manualmente para una tienda específica.
   */
  async updateBillsManually(store: string) {
    const storeCache = this.getStoreCache(store);
    storeCache.updating = true;
    const newBills = await this.fetchNewBills(store);
    if (newBills.length > 0) {
      storeCache.billsCache = [...newBills, ...storeCache.billsCache];
      // Reordenar toda la caché después de agregar las nuevas bills
      storeCache.billsCache.sort((a, b) => {
        const dateA = new Date(a.datetime || a.date);
        const dateB = new Date(b.datetime || b.date);
        return dateB.getTime() - dateA.getTime();
      });
      storeCache.progress = storeCache.billsCache.length;
      storeCache.lastBillDatetime = newBills[0].datetime;
      this.logger.log(
        `Nuevas bills agregadas manualmente para ${store}: ${newBills.length}`,
      );
    } else {
      this.logger.log(`No se encontraron nuevas bills para ${store} (manual).`);
    }
    storeCache.updating = false;
  }

  /**
   * Obtiene las bills en caché para una tienda específica.
   * @returns Un objeto con el estado de actualización, el progreso, si la carga está completa y los datos de las bills.
   */
  async getCachedBills(store: string): Promise<{ updating: boolean; progress: number; fullyLoaded: boolean; data: any[]; store: string; storeDisplayName: string }> {
    // Validar que la tienda sea válida
    this.storeCredentialsService.getCredentials(store); // Esto lanzará error si la tienda es inválida
    
    // Inicializar datos si es necesario
    await this.initializeStoreIfNeeded(store);
    
    const storeCache = this.getStoreCache(store);
    
    return {
      updating: storeCache.updating,
      progress: storeCache.progress,
      fullyLoaded: storeCache.fullyLoaded,
      data: storeCache.billsCache,
      store: store,
      storeDisplayName: this.storeCredentialsService.getStoreDisplayName(store),
    };
  }
}
