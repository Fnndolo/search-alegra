import { Controller, Get, Query, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { BillsDbService } from './bills.service.db';
import { StoreCredentialsService } from '../shared/store-credentials.service';

@Controller('bills')
export class BillsController {
  private readonly logger = new Logger(BillsController.name);

  constructor(
    private readonly billsDbService: BillsDbService,
    private readonly storeCredentialsService: StoreCredentialsService,
  ) {}

  @Get('all')
  async getAllBills(@Query('store') store: string) {
    try {
      this.logger.log(`📄 Getting bills for store: ${store}`);
      
      if (!store) {
        throw new BadRequestException('El parámetro "store" es requerido');
      }

      if (!this.storeCredentialsService.isValidStore(store)) {
        throw new BadRequestException(`Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`);
      }

      const result = await this.billsDbService.getCachedBills(store);
      this.logger.log(`✅ Bills retrieved for ${store}: ${result?.data?.length || 0} items`);
      
      // Si no hay datos, intentar cargar
      if (result.data.length === 0 && !result.updating) {
        this.logger.log(`🔄 No data found for ${store}, triggering initial load...`);
        // Forzar carga inicial en el background
        this.billsDbService.updateBillsManually(store).catch(error => {
          this.logger.error(`Error in background load for ${store}:`, error);
        });
      }
      
      return result;
    } catch (error) {
      this.logger.error(`❌ Error getting bills for store ${store}:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(`Error al obtener bills para la tienda ${store}: ${error.message}`);
    }
  }

   @Get('update')
  async updateBills(@Query('store') store: string) {
    if (!store) {
      throw new BadRequestException('El parámetro "store" es requerido');
    }

    if (!this.storeCredentialsService.isValidStore(store)) {
      throw new BadRequestException(`Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`);
    }

    await this.billsDbService.updateBillsManually(store);
    return this.billsDbService.getCachedBills(store);
  }

  @Get('reload')
  async reloadBills(@Query('store') store: string) {
    if (!store) {
      throw new BadRequestException('El parámetro "store" es requerido');
    }

    if (!this.storeCredentialsService.isValidStore(store)) {
      throw new BadRequestException(`Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`);
    }

    await this.billsDbService.clearCacheAndReload(store);
    return this.billsDbService.getCachedBills(store);
  }

  @Get('ensure-full-persistence')
  async ensureFullPersistence(@Query('store') store: string) {
    if (!store) {
      throw new BadRequestException('El parámetro "store" es requerido');
    }

    if (!this.storeCredentialsService.isValidStore(store)) {
      throw new BadRequestException(`Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`);
    }

    await this.billsDbService.ensureFullDataPersistence(store);
    return { message: `Persistencia completa asegurada para bills de ${store}` };
  }

  @Get('reset-sync')
  async resetSyncStatus(@Query('store') store: string) {
    if (!store) {
      throw new BadRequestException('El parámetro "store" es requerido');
    }

    if (!this.storeCredentialsService.isValidStore(store)) {
      throw new BadRequestException(`Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`);
    }

    await this.billsDbService.resetSyncStatus(store);
    return { message: `Estado de sincronización reseteado para bills de ${store}` };
  }
}
