import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { BillsDbService } from './bills.service.db';
import { StoreCredentialsService } from '../shared/store-credentials.service';

@Controller('bills')
export class BillsController {
  constructor(
    private readonly billsDbService: BillsDbService,
    private readonly storeCredentialsService: StoreCredentialsService,
  ) {}

  @Get('all')
  async getAllBills(@Query('store') store: string) {
    if (!store) {
      throw new BadRequestException('El parámetro "store" es requerido');
    }

    if (!this.storeCredentialsService.isValidStore(store)) {
      throw new BadRequestException(`Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`);
    }

    return this.billsDbService.getCachedBills(store);
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
