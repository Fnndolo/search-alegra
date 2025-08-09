import { Controller, Get, Post, Query, BadRequestException } from '@nestjs/common';
import { InvoicesService } from '../invoices/invoices.service';
import { BillsDbService } from '../bills/bills.service.db';
import { StoreCredentialsService } from '../shared/store-credentials.service';

@Controller('data-storage')
export class DataStorageController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly billsDbService: BillsDbService,
    private readonly storeCredentialsService: StoreCredentialsService,
  ) {}

  @Get('stats')
  async getStorageStats() {
    const stores = this.storeCredentialsService.getAllValidStores();
    const stats: any[] = [];

    for (const store of stores) {
      try {
        const invoicesData = await this.invoicesService.getCachedInvoices(store);
        const billsData = await this.billsDbService.getCachedBills(store);
        
        stats.push({
          store,
          displayName: this.storeCredentialsService.getStoreDisplayName(store),
          invoices: {
            total: invoicesData.total,
            progress: invoicesData.progress,
            fullyLoaded: invoicesData.fullyLoaded,
            updating: invoicesData.updating
          },
          bills: {
            total: billsData.total,
            progress: billsData.progress,
            fullyLoaded: billsData.fullyLoaded,
            updating: billsData.updating
          }
        });
      } catch (error) {
        stats.push({
          store,
          displayName: this.storeCredentialsService.getStoreDisplayName(store),
          error: error.message,
          invoices: { error: 'No disponible' },
          bills: { error: 'No disponible' }
        });
      }
    }

    return {
      stores: stats,
      totalStores: stores.length,
      timestamp: new Date().toISOString()
    };
  }

  @Post('ensure-full-persistence')
  async ensureFullPersistenceAllStores(@Query('store') store?: string) {
    const stores = store ? [store] : this.storeCredentialsService.getAllValidStores();
    
    for (const storeToProcess of stores) {
      if (!this.storeCredentialsService.isValidStore(storeToProcess)) {
        throw new BadRequestException(`Tienda inválida: ${storeToProcess}`);
      }
    }

    const results: any[] = [];
    
    for (const storeToProcess of stores) {
      try {
        // Asegurar persistencia de facturas
        const invoicesPromise = this.invoicesService.ensureFullDataPersistence(storeToProcess);
        
        // Asegurar persistencia de bills
        const billsPromise = this.billsDbService.ensureFullDataPersistence(storeToProcess);
        
        await Promise.all([invoicesPromise, billsPromise]);
        
        results.push({
          store: storeToProcess,
          displayName: this.storeCredentialsService.getStoreDisplayName(storeToProcess),
          status: 'success',
          message: 'Persistencia completa asegurada'
        });
      } catch (error) {
        results.push({
          store: storeToProcess,
          displayName: this.storeCredentialsService.getStoreDisplayName(storeToProcess),
          status: 'error',
          message: error.message
        });
      }
    }

    return {
      message: 'Proceso de persistencia completa ejecutado',
      results,
      processedStores: stores.length,
      timestamp: new Date().toISOString()
    };
  }

  @Post('reload-all')
  async reloadAllStores(@Query('store') store?: string) {
    const stores = store ? [store] : this.storeCredentialsService.getAllValidStores();
    
    for (const storeToProcess of stores) {
      if (!this.storeCredentialsService.isValidStore(storeToProcess)) {
        throw new BadRequestException(`Tienda inválida: ${storeToProcess}`);
      }
    }

    const results: any[] = [];
    
    for (const storeToProcess of stores) {
      try {
        // Recargar facturas
        const invoicesPromise = this.invoicesService.clearCacheAndReload(storeToProcess);
        
        // Recargar bills
        const billsPromise = this.billsDbService.clearCacheAndReload(storeToProcess);
        
        await Promise.all([invoicesPromise, billsPromise]);
        
        results.push({
          store: storeToProcess,
          displayName: this.storeCredentialsService.getStoreDisplayName(storeToProcess),
          status: 'success',
          message: 'Recarga completa exitosa'
        });
      } catch (error) {
        results.push({
          store: storeToProcess,
          displayName: this.storeCredentialsService.getStoreDisplayName(storeToProcess),
          status: 'error',
          message: error.message
        });
      }
    }

    return {
      message: 'Proceso de recarga completa ejecutado',
      results,
      processedStores: stores.length,
      timestamp: new Date().toISOString()
    };
  }
}
