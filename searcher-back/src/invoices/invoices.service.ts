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
import { Invoice } from '../entities/invoice.entity';
import { SyncStatus } from '../entities/sync-status.entity';

@Injectable()
export class InvoicesService {
  private readonly limit = 30;
  private readonly logger = new Logger(InvoicesService.name);
  private readonly maxRetries = 3;
  private readonly baseDelay = 1000;

  constructor(
    private readonly configService: ConfigService,
    private readonly storeCredentialsService: StoreCredentialsService,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(SyncStatus)
    private readonly syncStatusRepository: Repository<SyncStatus>,
  ) {}

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
    let syncStatus = await this.syncStatusRepository.findOne({
      where: { store, type: 'invoices' }
    });

    if (!syncStatus) {
      syncStatus = this.syncStatusRepository.create({
        store,
        type: 'invoices',
        totalRecords: 0,
        isFullyLoaded: false,
        isSyncing: false
      });
      await this.syncStatusRepository.save(syncStatus);
    }

    return syncStatus;
  }

  /**
   * Obtiene las facturas desde la base de datos con paginación
   */
  async getCachedInvoices(store: string): Promise<{ 
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
    
    // Si no hay datos, inicializar la carga
    if (syncStatus.totalRecords === 0 && !syncStatus.isSyncing) {
      this.logger.log(`Iniciando carga inicial para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
      this.initializeDataLoad(store).catch(error => {
        this.logger.error(`Error en carga inicial para ${store}`, error);
      });
    }
    
    // Obtener las facturas de la base de datos ordenadas por ID descendente, luego por fecha
    const invoices = await this.invoiceRepository.find({
      where: { store },
      order: { id: 'DESC', datetime: 'DESC', date: 'DESC' },
    });
    
    return {
      updating: syncStatus.isSyncing,
      progress: invoices.length,
      fullyLoaded: syncStatus.isFullyLoaded,
      data: invoices.map(inv => {
        const invoiceData = { ...inv.data };
        
        // Si tiene bankAccountName y payments, agregar bankAccount dentro de payments
        if (inv.bankAccountName && invoiceData.payments && invoiceData.payments.length > 0) {
          invoiceData.payments = invoiceData.payments.map(payment => ({
            ...payment,
            bankAccount: inv.bankAccountName
          }));
        }
        
        return invoiceData;
      }),
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
      this.logger.log(`Ya hay una sincronización en progreso para ${store}`);
      return;
    }

    syncStatus.isSyncing = true;
    await this.syncStatusRepository.save(syncStatus);

    try {
      await this.loadAllInvoicesFromAPI(store);
    } catch (error) {
      this.logger.error(`Error en inicialización de datos para ${store}`, error);
      syncStatus.isSyncing = false;
      await this.syncStatusRepository.save(syncStatus);
    }
  }

  /**
   * Carga todas las facturas desde la API
   */
  async loadAllInvoicesFromAPI(store: string): Promise<void> {
    const credentials = this.storeCredentialsService.getCredentials(store);
    const syncStatus = await this.getSyncStatus(store);
    
    try {
      // Obtener el total de facturas
      const metadataResponse = await this.makeRequestWithRetry(() => 
        axios.get(credentials.invoicesApiUrl, {
          params: { start: 0, limit: 1, metadata: true, order_direction: 'DESC' },
          headers: { Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}` },
        })
      );

      const total = metadataResponse.data.metadata?.total || 0;
      syncStatus.totalRecords = total;
      await this.syncStatusRepository.save(syncStatus);

      this.logger.log(`Iniciando carga de ${total} facturas para ${this.storeCredentialsService.getStoreDisplayName(store)}`);

      // Cargar en lotes
      let start = 0;
      const batchRequests: Promise<AxiosResponse<any>>[] = [];

      for (start = 0; start < total; start += this.limit) {
        batchRequests.push(
          this.makeRequestWithRetry(() =>
            axios.get(credentials.invoicesApiUrl, {
              params: { start, limit: this.limit, metadata: false, order_direction: 'DESC' },
              headers: { Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}` },
            })
          )
        );

        // Procesar en lotes de 2 requests para evitar rate limiting
        if (batchRequests.length === 2 || start + this.limit >= total) {
          try {
            const results = await Promise.allSettled(batchRequests);
            const newInvoices: any[] = [];
            
            results.forEach((result) => {
              if (result.status === 'fulfilled') {
                newInvoices.push(...(result.value.data.data || []));
              } else {
                this.logger.warn(`Error en batch request:`, result.reason?.message || result.reason);
              }
            });

            // Guardar en la base de datos
            if (newInvoices.length > 0) {
              await this.saveInvoicesToDB(store, newInvoices);
              
              const currentCount = await this.invoiceRepository.count({ where: { store } });
              this.logger.log(`Progreso de carga ${this.storeCredentialsService.getStoreDisplayName(store)}: ${currentCount}/${total} facturas`);
            }

          } catch (error) {
            this.logger.warn(`Error procesando lote para ${store} en start=${start}`, error);
          }

          batchRequests.length = 0;
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }

      // Verificar carga final
      const finalCount = await this.invoiceRepository.count({ where: { store } });
      syncStatus.isFullyLoaded = finalCount >= total;
      syncStatus.isSyncing = false;
      await this.syncStatusRepository.save(syncStatus);

      if (finalCount < total) {
        this.logger.warn(`⚠️  ADVERTENCIA: Solo se cargaron ${finalCount}/${total} facturas para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
      } else {
        this.logger.log(`✅ Carga completa finalizada para ${this.storeCredentialsService.getStoreDisplayName(store)}. Total: ${finalCount} facturas`);
      }

    } catch (error) {
      this.logger.error(`Error en carga de facturas para ${store}`, error);
      syncStatus.isSyncing = false;
      await this.syncStatusRepository.save(syncStatus);
    }
  }

  /**
   * Guarda las facturas en la base de datos
   */
  /**
   * Obtiene el medio de pago (nombre de la cuenta bancaria) desde la API de pagos
   */
  private async getPaymentMethod(store: string, invoiceData: any): Promise<string | null> {
    try {
      const credentials = this.storeCredentialsService.getCredentials(store);
      
      // Verificar si la factura tiene pagos
      if (!invoiceData.payments || invoiceData.payments.length === 0) {
        return null;
      }

      // Obtener el ID del primer pago
      const paymentId = invoiceData.payments[0].id;
      
      if (!paymentId) {
        return null;
      }

      // Llamar a la API de pagos
      const response = await this.makeRequestWithRetry(() =>
        axios.get(`https://api.alegra.com/api/v1/payments/${paymentId}`, {
          headers: { Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}` },
        })
      );

      const paymentData = response.data;
      
      // Retornar el nombre de la cuenta bancaria
      return paymentData?.bankAccount?.name || null;
      
    } catch (error) {
      this.logger.warn(`Error obteniendo medio de pago para factura ${invoiceData.id}:`, error.message);
      return null;
    }
  }

  private async saveInvoicesToDB(store: string, invoices: any[]): Promise<void> {
    for (const invoiceData of invoices) {
      // Obtener el medio de pago
      const paymentMethod = await this.getPaymentMethod(store, invoiceData);
      
      // Buscar si ya existe
      const existingInvoice = await this.invoiceRepository.findOne({
        where: { id: invoiceData.id, store }
      });

      if (existingInvoice) {
        // Actualizar
        existingInvoice.data = invoiceData;
        existingInvoice.datetime = invoiceData.datetime ? new Date(invoiceData.datetime) : null;
        existingInvoice.date = invoiceData.date ? new Date(invoiceData.date) : null;
        existingInvoice.bankAccountName = paymentMethod;
        await this.invoiceRepository.save(existingInvoice);
      } else {
        // Crear nuevo
        const invoice = new Invoice();
        invoice.id = invoiceData.id;
        invoice.store = store;
        invoice.data = invoiceData;
        invoice.datetime = invoiceData.datetime ? new Date(invoiceData.datetime) : null;
        invoice.date = invoiceData.date ? new Date(invoiceData.date) : null;
        invoice.bankAccountName = paymentMethod;
        await this.invoiceRepository.save(invoice);
      }
    }
  }

  /**
   * Actualiza solo las facturas nuevas
   */
  async updateInvoicesManually(store: string): Promise<void> {
    const syncStatus = await this.getSyncStatus(store);
    
    if (syncStatus.isSyncing) {
      this.logger.log(`Ya hay una actualización en progreso para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
      return;
    }

    // Si no hay datos, hacer carga completa
    if (syncStatus.totalRecords === 0) {
      this.logger.log(`No hay datos en caché para ${this.storeCredentialsService.getStoreDisplayName(store)}. Iniciando carga completa...`);
      await this.initializeDataLoad(store);
      return;
    }

    syncStatus.isSyncing = true;
    await this.syncStatusRepository.save(syncStatus);

    try {
      await this.fetchNewInvoices(store);
    } catch (error) {
      this.logger.error(`Error en actualización manual para ${store}`, error);
    } finally {
      syncStatus.isSyncing = false;
      await this.syncStatusRepository.save(syncStatus);
    }
  }

  /**
   * Obtiene las facturas nuevas desde la última sincronización
   */
  private async fetchNewInvoices(store: string): Promise<void> {
    const credentials = this.storeCredentialsService.getCredentials(store);
    
    // Obtener la última factura de la base de datos
    const lastInvoice = await this.invoiceRepository.findOne({
      where: { store },
      order: { datetime: 'DESC', date: 'DESC', id: 'DESC' }
    });

    if (!lastInvoice) {
      this.logger.log(`No hay facturas previas para ${store}, haciendo carga completa`);
      await this.loadAllInvoicesFromAPI(store);
      return;
    }

    const lastDate = lastInvoice.datetime ? 
      lastInvoice.datetime.toISOString().split('T')[0] : 
      lastInvoice.date?.toISOString().split('T')[0];

    this.logger.log(`Buscando facturas nuevas desde ${lastDate} para ${this.storeCredentialsService.getStoreDisplayName(store)}`);

    let newInvoices: any[] = [];

    try {
      // Buscar facturas posteriores a la última fecha
      const response = await this.makeRequestWithRetry(() =>
        axios.get(credentials.invoicesApiUrl, {
          params: {
            start: 0,
            limit: this.limit, // Usar el límite configurado de 30
            metadata: true,
            order_direction: 'DESC',
            date_after: lastDate,
          },
          headers: { Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}` },
        })
      );

      newInvoices = response.data.data || [];

      // También buscar en el mismo día por si hay nuevas facturas
      const sameDayResponse = await this.makeRequestWithRetry(() =>
        axios.get(credentials.invoicesApiUrl, {
          params: {
            start: 0,
            limit: this.limit,
            metadata: false,
            order_direction: 'DESC',
            date: lastDate,
          },
          headers: { Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}` },
        })
      );

      const sameDayInvoices = (sameDayResponse.data.data || []).filter((inv: any) =>
        inv.datetime && lastInvoice.datetime && 
        new Date(inv.datetime) > lastInvoice.datetime
      );

      newInvoices = [...newInvoices, ...sameDayInvoices];

      // Filtrar duplicados
      newInvoices = newInvoices.filter((inv, index, arr) =>
        arr.findIndex(i => i.id === inv.id) === index
      );

      if (newInvoices.length > 0) {
        await this.saveInvoicesToDB(store, newInvoices);
        this.logger.log(`✅ Se agregaron ${newInvoices.length} facturas nuevas para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
      } else {
        this.logger.log(`No se encontraron facturas nuevas para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
      }

    } catch (error) {
      this.logger.error(`Error obteniendo facturas nuevas para ${store}`, error);
      throw error;
    }
  }

  /**
   * Limpia toda la caché y recarga desde cero
   */
  async clearCacheAndReload(store: string): Promise<void> {
    this.logger.log(`Limpiando caché y recargando datos para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
    
    // Eliminar todas las facturas de esta tienda
    await this.invoiceRepository.delete({ store });
    
    // Resetear el estado de sincronización
    const syncStatus = await this.getSyncStatus(store);
    syncStatus.totalRecords = 0;
    syncStatus.isFullyLoaded = false;
    syncStatus.isSyncing = false;
    await this.syncStatusRepository.save(syncStatus);
    
    // Iniciar carga completa
    await this.initializeDataLoad(store);
  }

  /**
   * Fuerza la descarga completa de todas las facturas para asegurar persistencia total
   */
  async ensureFullDataPersistence(store: string): Promise<void> {
    const syncStatus = await this.getSyncStatus(store);
    
    if (syncStatus.isSyncing) {
      this.logger.log(`Ya hay una operación en progreso para facturas de ${store}`);
      return;
    }

    this.logger.log(`🔄 Asegurando persistencia completa de facturas para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
    
    syncStatus.isSyncing = true;
    await this.syncStatusRepository.save(syncStatus);

    try {
      await this.loadAllInvoicesFromAPI(store);
      this.logger.log(`✅ Persistencia completa asegurada para facturas de ${this.storeCredentialsService.getStoreDisplayName(store)}`);
    } catch (error) {
      this.logger.error(`❌ Error asegurando persistencia completa de facturas para ${store}`, error);
      throw error;
    } finally {
      syncStatus.isSyncing = false;
      await this.syncStatusRepository.save(syncStatus);
    }
  }

  /**
   * Actualiza una factura individual por su ID
   */
  async updateSingleInvoice(store: string, invoiceId: string): Promise<any> {
    this.logger.log(`Actualizando factura ${invoiceId} para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
    
    try {
      const credentials = this.storeCredentialsService.getCredentials(store);
      
      // Obtener la factura de la API
      const response = await this.makeRequestWithRetry(() =>
        axios.get(`${credentials.invoicesApiUrl}/${invoiceId}`, {
          headers: { Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}` },
        })
      );

      const invoiceData = response.data;
      
      if (!invoiceData) {
        throw new Error(`No se encontró la factura ${invoiceId}`);
      }

      // Guardar o actualizar la factura
      await this.saveInvoicesToDB(store, [invoiceData]);
      
      this.logger.log(`✅ Factura ${invoiceId} actualizada correctamente`);
      
      // Retornar la factura actualizada
      return invoiceData;
    } catch (error) {
      this.logger.error(`Error actualizando factura ${invoiceId} para ${store}`, error);
      throw new ServiceUnavailableException(`Error actualizando factura: ${error.message}`);
    }
  }

  /**
   * Obtiene una factura por su ID desde la base de datos
   */
  async getInvoiceById(store: string, invoiceId: string): Promise<any> {
    try {
      const invoice = await this.invoiceRepository.findOne({
        where: { 
          store,
          data: { id: invoiceId } as any
        }
      });

      if (!invoice) {
        return null;
      }

      // Retornar los datos de la factura con el bankAccount inyectado si existe
      const invoiceData = { ...invoice.data };
      if (invoice.bankAccountName && invoiceData.payments && invoiceData.payments.length > 0) {
        invoiceData.payments = invoiceData.payments.map(payment => ({
          ...payment,
          bankAccount: invoice.bankAccountName
        }));
      }

      return invoiceData;
    } catch (error) {
      this.logger.error(`Error obteniendo factura ${invoiceId} para ${store}`, error);
      return null;
    }
  }

  /**
   * Elimina una factura de la base de datos
   */
  async deleteSingleInvoice(store: string, invoiceId: string): Promise<void> {
    this.logger.log(`🗑️ Eliminando factura ${invoiceId} de ${this.storeCredentialsService.getStoreDisplayName(store)}`);
    
    try {
      // Buscar la factura en la base de datos
      const invoice = await this.invoiceRepository.findOne({
        where: { 
          store,
          data: { id: invoiceId } as any
        }
      });

      if (invoice) {
        await this.invoiceRepository.remove(invoice);
        this.logger.log(`✅ Factura ${invoiceId} eliminada de la base de datos`);
      } else {
        this.logger.warn(`⚠️ Factura ${invoiceId} no encontrada en la base de datos`);
      }
    } catch (error) {
      this.logger.error(`Error eliminando factura ${invoiceId} para ${store}`, error);
      throw new ServiceUnavailableException(`Error eliminando factura: ${error.message}`);
    }
  }

  /**
   * Recarga TODAS las facturas desde cero con sus medios de pago
   * Proceso optimizado:
   * 1. Elimina todas las facturas existentes
   * 2. Carga todas las facturas en lotes (rápido)
   * 3. Actualiza los medios de pago en segundo plano (lento pero no bloquea)
   */
  async reloadAllWithPayments(store: string): Promise<void> {
    this.logger.log(`🔄 Iniciando recarga completa con medios de pago para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
    
    const syncStatus = await this.getSyncStatus(store);
    
    if (syncStatus.isSyncing) {
      this.logger.warn(`Ya hay una recarga en progreso para ${store}`);
      return;
    }

    syncStatus.isSyncing = true;
    await this.syncStatusRepository.save(syncStatus);

    try {
      // Paso 1: Eliminar todas las facturas
      this.logger.log(`🗑️ Eliminando facturas existentes de ${store}...`);
      await this.invoiceRepository.delete({ store });
      
      // Paso 2: Resetear sync status
      syncStatus.totalRecords = 0;
      syncStatus.isFullyLoaded = false;
      await this.syncStatusRepository.save(syncStatus);
      
      // Paso 3: Cargar todas las facturas (sin medios de pago aún, rápido)
      this.logger.log(`📥 Cargando todas las facturas...`);
      await this.loadAllInvoicesFromAPI(store);
      
      // Paso 4: Actualizar medios de pago en segundo plano
      this.logger.log(`💳 Actualizando medios de pago...`);
      await this.updateAllPaymentMethods(store);
      
      this.logger.log(`✅ Recarga completa finalizada para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
      
    } catch (error) {
      this.logger.error(`Error en recarga completa para ${store}:`, error);
      throw error;
    } finally {
      syncStatus.isSyncing = false;
      await this.syncStatusRepository.save(syncStatus);
    }
  }

  /**
   * Actualiza los medios de pago de todas las facturas existentes
   * Se ejecuta en lotes pequeños para no sobrecargar la API
   */
  private async updateAllPaymentMethods(store: string): Promise<void> {
    const batchSize = 10; // Procesar 10 facturas a la vez
    let processed = 0;
    
    // Obtener todas las facturas que tienen pagos
    const allInvoices = await this.invoiceRepository.find({ 
      where: { store },
      order: { id: 'DESC' }
    });
    
    this.logger.log(`📊 Total de facturas a procesar: ${allInvoices.length}`);
    
    for (let i = 0; i < allInvoices.length; i += batchSize) {
      const batch = allInvoices.slice(i, i + batchSize);
      
      // Procesar este lote
      await Promise.all(
        batch.map(async (invoice) => {
          try {
            // Solo actualizar si tiene pagos en los datos
            if (invoice.data?.payments && invoice.data.payments.length > 0) {
              const paymentMethod = await this.getPaymentMethod(store, invoice.data);
              if (paymentMethod) {
                invoice.bankAccountName = paymentMethod;
                await this.invoiceRepository.save(invoice);
              }
            }
          } catch (error) {
            this.logger.warn(`Error actualizando pago de factura ${invoice.id}:`, error.message);
          }
        })
      );
      
      processed += batch.length;
      this.logger.log(`💳 Progreso: ${processed}/${allInvoices.length} facturas procesadas`);
      
      // Pausa entre lotes para no saturar la API
      if (i + batchSize < allInvoices.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    this.logger.log(`✅ Medios de pago actualizados para ${processed} facturas`);
  }
}

