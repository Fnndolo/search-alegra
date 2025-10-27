import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import axios from 'axios';
import { AxiosResponse } from 'axios';
import { StoreCredentialsService } from '../shared/store-credentials.service';
import { Bill } from '../entities/bill.entity';
import { SyncStatus } from '../entities/sync-status.entity';

@Injectable()
export class BillsDbService {
  private readonly limit = 30;
  private readonly logger = new Logger(BillsDbService.name);
  private readonly maxRetries = 3;
  private readonly baseDelay = 1000;

  constructor(
    private readonly configService: ConfigService,
    private readonly storeCredentialsService: StoreCredentialsService,
    @InjectRepository(Bill)
    private readonly billRepository: Repository<Bill>,
    @InjectRepository(SyncStatus)
    private readonly syncStatusRepository: Repository<SyncStatus>,
  ) { }

  /**
   * Método auxiliar para hacer requests con reintentos en caso de rate limiting
   */
  private async makeRequestWithRetry(requestFn: () => Promise<any>, retryCount = 0): Promise<any> {
    try {
      return await requestFn();
    } catch (error: any) {
      if (error.status === 429 && retryCount < this.maxRetries) {
        const delay = this.baseDelay * Math.pow(2, retryCount);
        this.logger.warn(`Rate limit alcanzado. Reintentando en ${delay}ms... (intento ${retryCount + 1}/${this.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequestWithRetry(requestFn, retryCount + 1);
      }
      throw error;
    }
  }

  /**
   * Obtiene o crea el estado de sincronización para una tienda
   */
  private async getSyncStatus(store: string): Promise<SyncStatus> {
    let syncStatus = await this.syncStatusRepository.findOneBy({
      store,
      type: 'bills'
    });

    if (!syncStatus) {
      // Usar upsert para evitar duplicados
      try {
        syncStatus = this.syncStatusRepository.create({
          store,
          type: 'bills',
          totalRecords: 0,
          isFullyLoaded: false,
          isSyncing: false
        });
        await this.syncStatusRepository.save(syncStatus);
      } catch (error) {
        // Si hay un error de duplicate key, buscar el registro existente
        syncStatus = await this.syncStatusRepository.findOneBy({
          store,
          type: 'bills'
        });
        if (!syncStatus) {
          throw error; // Si aún no se puede encontrar, lanzar el error original
        }
      }
    }

    return syncStatus;
  }

  /**
   * Obtiene las bills desde la base de datos con paginación
   */
  async getCachedBills(store: string): Promise<{
    updating: boolean;
    progress: number;
    fullyLoaded: boolean;
    data: any[];
    store: string;
    storeDisplayName: string;
    total: number;
  }> {
    // Validar que la tienda sea válida
    this.storeCredentialsService.getCredentials(store);

    const syncStatus = await this.getSyncStatus(store);

    this.logger.log(`Estado de bills para ${store}: totalRecords=${syncStatus.totalRecords}, isSyncing=${syncStatus.isSyncing}, isFullyLoaded=${syncStatus.isFullyLoaded}`);

    // Si no hay datos o la carga no está completa, inicializar la carga
    if ((!syncStatus.isFullyLoaded || syncStatus.totalRecords === 0) && !syncStatus.isSyncing) {
      this.logger.log(`Iniciando carga inicial de bills para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
      this.initializeDataLoad(store).catch(error => {
        this.logger.error(`Error en carga inicial de bills para ${store}`, error);
      });
    } else {
      this.logger.log(`No se inicia carga: totalRecords=${syncStatus.totalRecords}, isSyncing=${syncStatus.isSyncing}, isFullyLoaded=${syncStatus.isFullyLoaded}`);
    }

    // Obtener las bills de la base de datos ordenadas por ID descendente, luego por fecha
    const bills = await this.billRepository.find({
      where: { store },
      order: { id: 'DESC', date: 'DESC' },
    });

    return {
      updating: syncStatus.isSyncing,
      progress: bills.length,
      fullyLoaded: syncStatus.isFullyLoaded,
      data: bills.map(bill => bill.data), // Retornar solo los datos de las bills
      store: store,
      storeDisplayName: this.storeCredentialsService.getStoreDisplayName(store),
      total: syncStatus.totalRecords
    };
  }

  /**
   * Inicializa la carga de datos en segundo plano
   */
  private async initializeDataLoad(store: string): Promise<void> {
    const syncStatus = await this.getSyncStatus(store);

    if (syncStatus.isSyncing) {
      this.logger.log(`Ya hay una sincronización de bills en progreso para ${store}`);
      return;
    }

    syncStatus.isSyncing = true;
    await this.syncStatusRepository.save(syncStatus);

    try {
      await this.loadAllBillsFromAPI(store);
    } catch (error) {
      this.logger.error(`Error en inicialización de bills para ${store}`, error);
      syncStatus.isSyncing = false;
      await this.syncStatusRepository.save(syncStatus);
    }
  }

  /**
   * Resetea el estado de sincronización para una tienda
   */
  async resetSyncStatus(store: string): Promise<void> {
    this.logger.log(`Reseteando estado de sincronización de bills para ${store}`);

    const syncStatus = await this.getSyncStatus(store);
    syncStatus.isSyncing = false;
    syncStatus.isFullyLoaded = false;
    syncStatus.lastSyncDatetime = null;
    await this.syncStatusRepository.save(syncStatus);

    this.logger.log(`Estado de sincronización reseteado para ${store}`);
  }

  /**
   * Carga todas las bills desde la API
   */
  private async loadAllBillsFromAPI(store: string): Promise<void> {
    const credentials = this.storeCredentialsService.getCredentials(store);
    const syncStatus = await this.getSyncStatus(store);

    try {
      // Obtener el total de bills
      const metadataResponse = await this.makeRequestWithRetry(() =>
        axios.get(credentials.billsApiUrl, {
          params: { start: 0, limit: 1, metadata: true, order_direction: 'DESC' },
          headers: { Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}` },
        })
      );

      const total = metadataResponse.data.metadata?.total || 0;
      syncStatus.totalRecords = total;
      await this.syncStatusRepository.save(syncStatus);

      this.logger.log(`Iniciando carga de ${total} bills para ${this.storeCredentialsService.getStoreDisplayName(store)}`);

      // Cargar en lotes
      let start = 0;
      const batchRequests: Promise<AxiosResponse<any>>[] = [];

      this.logger.log(`📊 Empezando descarga de bills para ${store}. Total a descargar: ${total}`);
      this.logger.log(`🔗 URL: ${credentials.billsApiUrl}`);
      this.logger.log(`🔑 API Key prefix: ${credentials.apiKey?.substring(0, 10)}...`);

      for (start = 0; start < total; start += this.limit) {
        this.logger.log(`📥 Preparando batch para start=${start}, limit=${this.limit}`);

        batchRequests.push(
          this.makeRequestWithRetry(() =>
            axios.get(credentials.billsApiUrl, {
              params: { start, limit: this.limit, metadata: false, order_direction: 'DESC' },
              headers: { Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}` },
            })
          )
        );

        // Procesar en lotes de 2 requests para evitar rate limiting
        if (batchRequests.length === 2 || start + this.limit >= total) {
          this.logger.log(`🔄 Procesando lote de ${batchRequests.length} requests para ${store}`);

          try {
            const results = await Promise.allSettled(batchRequests);
            const newBills: any[] = [];

            results.forEach((result, index) => {
              if (result.status === 'fulfilled') {
                const responseData = result.value.data;
                // Para bills, la API devuelve directamente un array, no un objeto con propiedad 'data'
                const billsData = Array.isArray(responseData) ? responseData : (responseData.data || []);
                this.logger.log(`📋 Response ${index}: status=${result.value.status}, bills.length=${billsData.length}, total=${responseData.total || 'undefined'}`);
                this.logger.log(`📋 Response ${index} structure:`, JSON.stringify(responseData, null, 2).substring(0, 500));
                newBills.push(...billsData);
              } else {
                this.logger.warn(`❌ Error en batch request ${index}:`, result.reason?.message || result.reason);
              }
            });

            // Guardar en la base de datos
            if (newBills.length > 0) {
              this.logger.log(`💾 Guardando ${newBills.length} bills en la base de datos para ${store}`);
              await this.saveBillsToDB(store, newBills);

              const currentCount = await this.billRepository.count({ where: { store } });
              this.logger.log(`Progreso de carga bills ${this.storeCredentialsService.getStoreDisplayName(store)}: ${currentCount}/${total} bills`);
            } else {
              this.logger.warn(`⚠️ No se obtuvieron bills en este lote para ${store}`);
            }

          } catch (error) {
            this.logger.warn(`Error procesando lote de bills para ${store} en start=${start}`, error);
          }

          batchRequests.length = 0;
          this.logger.log(`⏱️ Esperando 800ms antes del siguiente lote...`);
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }

      // Verificar carga final
      const finalCount = await this.billRepository.count({ where: { store } });
      syncStatus.isFullyLoaded = finalCount >= total;
      syncStatus.isSyncing = false;
      await this.syncStatusRepository.save(syncStatus);

      if (finalCount < total) {
        this.logger.warn(`⚠️  ADVERTENCIA: Solo se cargaron ${finalCount}/${total} bills para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
      } else {
        this.logger.log(`✅ Carga completa de bills finalizada para ${this.storeCredentialsService.getStoreDisplayName(store)}. Total: ${finalCount} bills`);
      }

    } catch (error) {
      this.logger.error(`Error en carga de bills para ${store}`, error);
      syncStatus.isSyncing = false;
      await this.syncStatusRepository.save(syncStatus);
    }
  }

  /**
   * Guarda las bills en la base de datos
   */
  private async saveBillsToDB(store: string, bills: any[]): Promise<void> {
    for (const billData of bills) {
      // Buscar si ya existe
      const existingBill = await this.billRepository.findOne({
        where: { id: billData.id, store }
      });

      if (existingBill) {
        // Actualizar
        existingBill.data = billData;
        existingBill.datetime = null;
        existingBill.date = billData.date ? new Date(billData.date) : null;
        await this.billRepository.save(existingBill);
      } else {
        // Crear nuevo
        const bill = new Bill();
        bill.id = billData.id;
        bill.store = store;
        bill.data = billData;
        bill.datetime = null;
        bill.date = billData.date ? new Date(billData.date) : null;
        await this.billRepository.save(bill);
      }
    }
  }

  /**
   * Actualiza solo las bills nuevas
   */
  async updateBillsManually(store: string): Promise<void> {
    this.logger.log(`🚀 INICIANDO updateBillsManually para ${store}`);

    const syncStatus = await this.getSyncStatus(store);
    this.logger.log(`📊 syncStatus obtenido: totalRecords=${syncStatus.totalRecords}, isSyncing=${syncStatus.isSyncing}`);

    if (syncStatus.isSyncing) {
      this.logger.log(`Ya hay una actualización de bills en progreso para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
      return;
    }

    // Si no hay datos, hacer carga completa
    if (syncStatus.totalRecords === 0) {
      this.logger.log(`No hay datos de bills en caché para ${this.storeCredentialsService.getStoreDisplayName(store)}. Iniciando carga completa...`);
      await this.initializeDataLoad(store);
      return;
    }

    this.logger.log(`🔄 Iniciando actualización manual de bills para ${this.storeCredentialsService.getStoreDisplayName(store)}`);

    syncStatus.isSyncing = true;
    await this.syncStatusRepository.save(syncStatus);
    this.logger.log(`💾 syncStatus marcado como isSyncing=true`);

    try {
      this.logger.log(`🔍 Llamando a fetchNewBills...`);
      await this.fetchNewBills(store);
      this.logger.log(`✅ fetchNewBills completado`);
    } catch (error) {
      this.logger.error(`Error en actualización manual de bills para ${store}`, error);
    } finally {
      this.logger.log(`🔚 Finalizando updateBillsManually, marcando isSyncing=false`);
      syncStatus.isSyncing = false;
      await this.syncStatusRepository.save(syncStatus);
    }
  }

  /**
   * Obtiene las bills nuevas desde la última sincronización
   */
  private async fetchNewBills(store: string): Promise<void> {
    this.logger.log(`🎯 ENTRANDO A fetchNewBills para ${store}`);

    const credentials = this.storeCredentialsService.getCredentials(store);
    this.logger.log(`🔑 Credenciales obtenidas para ${store}`);

    // Obtener la fecha de hoy para buscar bills de hoy
    const today = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD
    this.logger.log(`� Buscando bills de hoy: ${today}`);

    let newBills: any[] = [];

    try {
      // Buscar bills de hoy usando el parámetro 'date' que funciona en Postman
      this.logger.log(`🌐 Buscando bills con date=${today}`);

      // Log de las credenciales para debug
      const authHeader = `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`;
      this.logger.log(`🔑 API Key usado: ${credentials.apiKey}`);
      this.logger.log(`🔑 Auth header: ${authHeader}`);
      this.logger.log(`🌐 URL completa: ${credentials.billsApiUrl}`);

      const params = {
        metadata: false,
        limit: 30,
        order_direction: 'ASC',
        date: today,
        type: 'bill'
      };

      this.logger.log(`📋 Parámetros enviados: ${JSON.stringify(params)}`);

      const response = await this.makeRequestWithRetry(() =>
        axios.get(credentials.billsApiUrl, {
          params,
          headers: { Authorization: authHeader },
        })
      );

      this.logger.log(`📡 Respuesta completa de la API: ${JSON.stringify(response.data, null, 2)}`);

      // La respuesta puede ser un array directo o un objeto con data
      newBills = Array.isArray(response.data) ? response.data : (response.data.data || []);
      this.logger.log(`📋 Bills encontradas para ${today}: ${newBills.length}`);

      if (newBills.length > 0) {
        // Mostrar los IDs de las bills encontradas
        this.logger.log(`� IDs de bills de hoy: ${newBills.map(b => b.id).join(', ')}`);

        // Filtrar bills que no están en la base de datos
        const existingBillsQuery = await this.billRepository.find({
          where: { store },
          select: ['id']
        });
        const existingIds = new Set(existingBillsQuery.map(bill => parseInt(bill.id.toString())));

        this.logger.log(`🔍 IDs existentes en DB (total: ${existingIds.size})`);

        const beforeFilter = newBills.length;
        newBills = newBills.filter(bill => !existingIds.has(parseInt(bill.id.toString())));

        this.logger.log(`📋 Bills nuevas después de filtrar existentes: ${newBills.length} (eliminadas: ${beforeFilter - newBills.length})`);

        if (newBills.length > 0) {
          this.logger.log(`💾 Guardando ${newBills.length} bills nuevas...`);
          this.logger.log(`🆕 IDs de bills nuevas a guardar: ${newBills.map(b => b.id).join(', ')}`);

          await this.saveBillsToDB(store, newBills);
          this.logger.log(`✅ ${newBills.length} bills nuevas agregadas para ${this.storeCredentialsService.getStoreDisplayName(store)}`);

          // Actualizar el total
          const syncStatus = await this.getSyncStatus(store);
          const currentCount = await this.billRepository.count({ where: { store } });
          syncStatus.totalRecords = Math.max(syncStatus.totalRecords, currentCount);
          await this.syncStatusRepository.save(syncStatus);
        } else {
          this.logger.log(`❌ No hay bills nuevas para ${this.storeCredentialsService.getStoreDisplayName(store)} - todas ya existen en DB`);
        }
      } else {
        this.logger.log(`❌ No hay bills de hoy para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
      }

    } catch (error) {
      this.logger.error(`Error buscando bills nuevas para ${store}`, error);
      throw error;
    }
  }

  /**
   * Limpia caché y recarga todo (fuerza carga completa sin eliminar datos existentes)
   */
  async clearCacheAndReload(store: string): Promise<void> {
    const syncStatus = await this.getSyncStatus(store);

    this.logger.log(`Forzando recarga completa de bills para ${this.storeCredentialsService.getStoreDisplayName(store)}`);

    // Resetear el estado pero NO eliminar los datos de la base de datos
    syncStatus.isSyncing = false;
    syncStatus.isFullyLoaded = false;
    await this.syncStatusRepository.save(syncStatus);

    // Iniciar carga completa (esto agregará nuevos datos sin eliminar existentes)
    await this.initializeDataLoad(store);
  }

  /**
   * Fuerza la descarga completa de todas las bills para asegurar persistencia total
   */
  async ensureFullDataPersistence(store: string): Promise<void> {
    const syncStatus = await this.getSyncStatus(store);

    if (syncStatus.isSyncing) {
      this.logger.log(`Ya hay una operación en progreso para bills de ${store}`);
      return;
    }

    this.logger.log(`🔄 Asegurando persistencia completa de bills para ${this.storeCredentialsService.getStoreDisplayName(store)}`);

    syncStatus.isSyncing = true;
    await this.syncStatusRepository.save(syncStatus);

    try {
      await this.loadAllBillsFromAPI(store);
      this.logger.log(`✅ Persistencia completa asegurada para bills de ${this.storeCredentialsService.getStoreDisplayName(store)}`);
    } catch (error) {
      this.logger.error(`❌ Error asegurando persistencia completa de bills para ${store}`, error);
      throw error;
    } finally {
      syncStatus.isSyncing = false;
      await this.syncStatusRepository.save(syncStatus);
    }
  }

  /**
   * Actualiza una cuenta por pagar individual por su ID
   */
  async updateSingleBill(store: string, billId: string): Promise<any> {
    this.logger.log(`Actualizando cuenta por pagar ${billId} para ${this.storeCredentialsService.getStoreDisplayName(store)}`);

    try {
      const credentials = this.storeCredentialsService.getCredentials(store);

      // Obtener la bill de la API
      const response = await this.makeRequestWithRetry(() =>
        axios.get(`${credentials.billsApiUrl}/${billId}`, {
          headers: { Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}` },
        })
      );

      const billData = response.data;

      if (!billData) {
        throw new Error(`No se encontró la cuenta por pagar ${billId}`);
      }

      // Guardar o actualizar la bill
      await this.saveBillsToDB(store, [billData]);

      this.logger.log(`✅ Cuenta por pagar ${billId} actualizada correctamente`);

      // Retornar la bill actualizada
      return billData;
    } catch (error) {
      this.logger.error(`Error actualizando cuenta por pagar ${billId} para ${store}`, error);
      throw new ServiceUnavailableException(`Error actualizando cuenta por pagar: ${error.message}`);
    }
  }

  /**
   * Obtiene una cuenta por pagar por su ID desde la base de datos
   */
  async getBillById(store: string, billId: string): Promise<any> {
    try {
      const bill = await this.billRepository.findOne({
        where: {
          store,
          data: { id: billId } as any
        }
      });

      if (!bill) {
        return null;
      }

      // Retornar los datos de la bill
      return bill.data;
    } catch (error) {
      this.logger.error(`Error obteniendo cuenta por pagar ${billId} para ${store}`, error);
      return null;
    }
  }

  /**
   * Elimina una cuenta por pagar de la base de datos
   */
  async deleteSingleBill(store: string, billId: string): Promise<void> {
    this.logger.log(`🗑️ Eliminando cuenta por pagar ${billId} de ${this.storeCredentialsService.getStoreDisplayName(store)}`);

    try {
      // Buscar la bill en la base de datos
      const bill = await this.billRepository.findOne({
        where: {
          store,
          data: { id: billId } as any
        }
      });

      if (bill) {
        await this.billRepository.remove(bill);
        this.logger.log(`✅ Cuenta por pagar ${billId} eliminada de la base de datos`);
      } else {
        this.logger.warn(`⚠️ Cuenta por pagar ${billId} no encontrada en la base de datos`);
      }
    } catch (error) {
      this.logger.error(`Error eliminando cuenta por pagar ${billId} para ${store}`, error);
      throw new ServiceUnavailableException(`Error eliminando cuenta por pagar: ${error.message}`);
    }
  }
}
