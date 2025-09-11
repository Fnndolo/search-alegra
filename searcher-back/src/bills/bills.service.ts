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
  private readonly maxRetries = 3;
  private readonly baseDelay = 1000; // 1 segundo base

  // Cache por tienda
  private storeCaches: Map<string, StoreCache> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly storeCredentialsService: StoreCredentialsService,
  ) {}

  /**
   * Método auxiliar para hacer requests con reintentos en caso de rate limiting
   */
  private async makeRequestWithRetry(requestFn: () => Promise<any>, retryCount = 0): Promise<any> {
    try {
      return await requestFn();
    } catch (error: any) {
      if (error.status === 429 && retryCount < this.maxRetries) {
        const delay = this.baseDelay * Math.pow(2, retryCount); // Delay exponencial
        this.logger.warn(`Rate limit alcanzado. Reintentando en ${delay}ms... (intento ${retryCount + 1}/${this.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequestWithRetry(requestFn, retryCount + 1);
      }
      throw error;
    }
  }

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
        storeCache.lastBillDatetime = initialBills[0].datetime || initialBills[0].date;
      }
      
      this.logger.log(
        `Bills iniciales cargadas para ${this.storeCredentialsService.getStoreDisplayName(store)}: ${storeCache.billsCache.length}`,
      );
      
      storeCache.updating = false;
      
      // Continuar descargando el resto en segundo plano
      try {
        this.logger.log(`Iniciando carga en segundo plano para ${this.storeCredentialsService.getStoreDisplayName(store)}...`);
        this.continueLoadingInBackground(store);
      } catch (error) {
        this.logger.error(`Error iniciando carga en segundo plano para ${store}`, error);
      }
      
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

      // La API de bills devuelve un objeto con metadata y data, no directamente un array
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
      this.logger.log(`Total bills detectadas para ${this.storeCredentialsService.getStoreDisplayName(store)}: ${total}, Ya cargadas: ${alreadyLoaded}`);
      
      if (alreadyLoaded >= total) {
        storeCache.updating = false;
        storeCache.fullyLoaded = true;
        this.logger.log(`Todas las bills ya están cargadas para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
        return;
      }

      this.logger.log(`Continuando carga de bills en segundo plano para ${this.storeCredentialsService.getStoreDisplayName(store)}. ${alreadyLoaded}/${total} bills`);

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

        // Procesar en lotes de 2 requests para evitar rate limiting
        if (batchRequests.length === 2 || start + this.limit >= total) {
          try {
            const results = await Promise.allSettled(batchRequests);
            let newBills: any[] = [];
            
            results.forEach((result) => {
              if (result.status === 'fulfilled') {
                // La API de bills devuelve la data directamente en batch.data, no en batch.data.data
                const billsData = result.value.data.data || result.value.data || [];
                newBills = newBills.concat(billsData);
              } else {
                this.logger.warn(`Error en batch request:`, result.reason?.message || result.reason);
                // Si hay error de rate limiting, esperamos más tiempo
                if (result.reason?.status === 429) {
                  this.logger.warn(`Rate limit detectado en background loading`);
                }
              }
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

            this.logger.log(`Progreso de carga bills ${this.storeCredentialsService.getStoreDisplayName(store)}: ${storeCache.progress}/${total} bills`);

          } catch (error) {
            this.logger.warn(`Error fetching background bills batch for ${this.storeCredentialsService.getStoreDisplayName(store)} at start=${start}`, error);
            // En caso de error, continuamos con el siguiente lote en lugar de terminar
          }

          batchRequests.length = 0;
          // Pausa entre lotes para no sobrecargar la API
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }

      // Ordenar toda la caché al final para garantizar orden correcto
      storeCache.billsCache.sort((a, b) => {
        const dateA = new Date(a.datetime || a.date);
        const dateB = new Date(b.datetime || b.date);
        return dateB.getTime() - dateA.getTime();
      });

      // Verificar si realmente cargamos todos los datos
      const finalCount = storeCache.billsCache.length;
      if (finalCount < total) {
        this.logger.warn(`⚠️  ADVERTENCIA: Solo se cargaron ${finalCount}/${total} bills para ${this.storeCredentialsService.getStoreDisplayName(store)}. Faltan ${total - finalCount} bills.`);
        storeCache.fullyLoaded = false; // Marcar como no completamente cargado
      } else {
        storeCache.fullyLoaded = true;
      }

      storeCache.updating = false;
      this.logger.log(`Carga completa de bills finalizada para ${this.storeCredentialsService.getStoreDisplayName(store)}. Total: ${storeCache.billsCache.length}/${total} bills`);

    } catch (error) {
      this.logger.error(`Error en la carga en segundo plano de bills para ${this.storeCredentialsService.getStoreDisplayName(store)}`, error);
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
      if (batchRequests.length === 2 || start + this.limit >= total) {
        try {
          const results = await Promise.all(batchRequests);
          results.forEach((batch) => {
            // La API de bills devuelve la data directamente en batch.data, no en batch.data.data
            const billsData = batch.data.data || batch.data || [];
            allBills = allBills.concat(billsData);
            storeCache.progress = allBills.length;
          });
        } catch (error) {
          this.logger.warn(`Error fetching bills batch for ${store} at start=${start}`, error);
          throw new ServiceUnavailableException(`Error al obtener bills para ${store}`);
        }
        batchRequests.length = 0;
        await new Promise((resolve) => setTimeout(resolve, 400));
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
    // Extraer solo la fecha (sin hora) de la última bill conocida
    let lastDate = storeCache.lastBillDatetime.includes(' ') ? 
      storeCache.lastBillDatetime.split(' ')[0] : 
      storeCache.lastBillDatetime;

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
          // Obtener la fecha de la última bill del lote y extraer solo la fecha (sin hora)
          const lastBillDatetime = batchBills[batchBills.length - 1].datetime || batchBills[batchBills.length - 1].date;
          if (lastBillDatetime) {
            lastDate = lastBillDatetime.includes(' ') ? lastBillDatetime.split(' ')[0] : lastBillDatetime;
          }
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
      // Usar la fecha de la última bill conocida, no la del último lote
      const sameDayDate = storeCache.lastBillDatetime.includes(' ') ? 
        storeCache.lastBillDatetime.split(' ')[0] : 
        storeCache.lastBillDatetime;
        
      while (keepFetchingSameDay) {
        const response = await axios.get(credentials.billsApiUrl, {
          params: {
            start: sameDayStart,
            limit: this.limit,
            metadata: sameDayStart === 0,
            order_direction: 'DESC',
            date: sameDayDate,
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
   * Limpia la caché para una tienda específica y fuerza una recarga completa
   */
  async clearCacheAndReload(store: string) {
    const storeCache = this.getStoreCache(store);
    
    // Limpiar la caché
    storeCache.billsCache = [];
    storeCache.updating = false;
    storeCache.fullyLoaded = false;
    storeCache.progress = 0;
    storeCache.lastBillDatetime = null;
    
    this.logger.log(`Caché limpiada para ${this.storeCredentialsService.getStoreDisplayName(store)}. Iniciando recarga completa...`);
    
    // Reinicializar
    await this.initializeStoreIfNeeded(store);
  }

  /**
   * Carga todas las bills desde la API
   */
  async loadAllBillsFromAPI(store: string): Promise<void> {
    try {
      const bills = await this.fetchAllBills(store);
      const storeCache = this.getStoreCache(store);
      storeCache.billsCache = bills;
      storeCache.progress = bills.length;
      if (bills.length > 0) {
        storeCache.lastBillDatetime = bills[0].datetime || bills[0].date;
      }
      storeCache.fullyLoaded = true;
      storeCache.updating = false;
    } catch (error) {
      this.logger.error(`Error cargando todas las bills para ${store}`, error);
      throw error;
    }
  }

  /**
   * Actualiza las bills manualmente para una tienda específica.
   */
  async updateBillsManually(store: string) {
    const storeCache = this.getStoreCache(store);
    
    // Si no hay datos en caché, hacer una carga completa
    if (storeCache.billsCache.length === 0) {
      this.logger.log(`No hay bills en caché para ${this.storeCredentialsService.getStoreDisplayName(store)}. Iniciando carga completa...`);
      await this.clearCacheAndReload(store);
      return;
    }
    
    if (storeCache.updating) {
      this.logger.log(`Ya hay una actualización en progreso para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
      return;
    }
    
    storeCache.updating = true;
    
    try {
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
        storeCache.lastBillDatetime = newBills[0].datetime || newBills[0].date;
        this.logger.log(
          `Nuevas bills agregadas manualmente para ${this.storeCredentialsService.getStoreDisplayName(store)}: ${newBills.length}`,
        );
      } else {
        this.logger.log(`No se encontraron nuevas bills para ${this.storeCredentialsService.getStoreDisplayName(store)} (manual).`);
      }
    } catch (error) {
      this.logger.error(`Error en actualización manual de bills para ${this.storeCredentialsService.getStoreDisplayName(store)}`, error);
    } finally {
      storeCache.updating = false;
    }
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
