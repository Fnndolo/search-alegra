import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  Query,
  BadRequestException,
  Logger,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import { BillsDbService } from './bills.service.db';
import { BillsDetailService, BillUpdatePayload } from './bills-detail.service';
import { StoreCredentialsService } from '../shared/store-credentials.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../entities/user.entity';

@Controller('bills')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.USUARIO, UserRole.FACTURACION, UserRole.COMPRAS)
export class BillsController {
  private readonly logger = new Logger(BillsController.name);

  constructor(
    private readonly billsDbService: BillsDbService,
    private readonly billsDetailService: BillsDetailService,
    private readonly storeCredentialsService: StoreCredentialsService,
  ) {}

  /**
   * Valida que la tienda exista y sea una sede concreta (no el agregado "todas"),
   * que es lo que necesitan las operaciones sobre un documento puntual.
   */
  private assertPhysicalStore(store: string): string {
    if (!store) {
      throw new BadRequestException('El parámetro "store" es requerido');
    }
    if (!this.storeCredentialsService.isValidStore(store)) {
      throw new BadRequestException(
        `Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`,
      );
    }
    if (store.toLowerCase() === 'todas') {
      throw new BadRequestException('Debe indicarse la sede concreta del documento, no "todas".');
    }
    return store.toLowerCase();
  }

  // ─── Detalle y edición de una factura de compra ───────────────────────

  @Get('detail')
  async getBillDetail(@Query('store') store: string, @Query('id') id: string) {
    const validStore = this.assertPhysicalStore(store);
    if (!id) {
      throw new BadRequestException('El parámetro "id" es requerido');
    }
    return this.billsDetailService.getBillDetail(validStore, id);
  }

  @Get('company')
  async getCompany(@Query('store') store: string) {
    return this.billsDetailService.getCompany(this.assertPhysicalStore(store));
  }

  @Get('catalog/providers')
  @Roles(UserRole.ADMIN, UserRole.COMPRAS)
  async getProviders(@Query('store') store: string, @Query('query') query?: string) {
    return this.billsDetailService.getProviders(this.assertPhysicalStore(store), query);
  }

  @Post('catalog/providers')
  @Roles(UserRole.ADMIN, UserRole.COMPRAS)
  async createProvider(
    @Query('store') store: string,
    @Body() body: { name: string; identification?: string; phone?: string; email?: string },
  ) {
    const validStore = this.assertPhysicalStore(store);
    if (!body?.name?.trim()) {
      throw new BadRequestException('El nombre del proveedor es requerido');
    }
    return this.billsDetailService.createProvider(validStore, body);
  }

  @Get('catalog/items')
  @Roles(UserRole.ADMIN, UserRole.COMPRAS)
  async getItems(@Query('store') store: string, @Query('query') query?: string) {
    return this.billsDetailService.getItems(this.assertPhysicalStore(store), query);
  }

  @Get('catalog/warehouses')
  @Roles(UserRole.ADMIN, UserRole.COMPRAS)
  async getWarehouses(@Query('store') store: string) {
    return this.billsDetailService.getWarehouses(this.assertPhysicalStore(store));
  }

  @Get('catalog/taxes')
  @Roles(UserRole.ADMIN, UserRole.COMPRAS)
  async getTaxes(@Query('store') store: string) {
    return this.billsDetailService.getTaxes(this.assertPhysicalStore(store));
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.COMPRAS)
  async updateBill(
    @Param('id') id: string,
    @Query('store') store: string,
    @Body() body: BillUpdatePayload,
  ) {
    const validStore = this.assertPhysicalStore(store);
    this.logger.log(`✏️ Edición de compra ${id} en ${validStore}`);
    return this.billsDetailService.updateBill(validStore, id, body || {});
  }

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
      this.logger.log(`📊 Bills result structure:`, {
        updating: result?.updating,
        progress: result?.progress,
        fullyLoaded: result?.fullyLoaded,
        dataLength: result?.data?.length,
        store: result?.store,
        total: result?.total
      });
      
      // Si no hay datos y no es "todas", intentar cargar
      if (result.data.length === 0 && !result.updating && store?.toLowerCase() !== 'todas') {
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

    if (store?.toLowerCase() === 'todas') {
      throw new BadRequestException('No se puede actualizar manualmente "todas" las tiendas. Por favor, actualiza cada tienda individualmente.');
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

    if (store?.toLowerCase() === 'todas') {
      throw new BadRequestException('No se puede recargar "todas" las tiendas. Por favor, recarga cada tienda individualmente.');
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

    if (store?.toLowerCase() === 'todas') {
      throw new BadRequestException('No se puede ejecutar "ensure-full-persistence" para "todas" las tiendas. Por favor, ejecuta para cada tienda individualmente.');
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

    if (store?.toLowerCase() === 'todas') {
      throw new BadRequestException('No se puede resetear el estado de sincronización para "todas" las tiendas. Por favor, ejecuta para cada tienda individualmente.');
    }

    await this.billsDbService.resetSyncStatus(store);
    return { message: `Estado de sincronización reseteado para bills de ${store}` };
  }
}
