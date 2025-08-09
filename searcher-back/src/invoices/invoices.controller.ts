import { Controller, Get, Query, BadRequestException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { StoreCredentialsService } from '../shared/store-credentials.service';

@Controller('invoices')
export class InvoicesController {
  private readonly logger = new Logger(InvoicesController.name);

  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly storeCredentialsService: StoreCredentialsService,
  ) {}

  @Get('all')
  async getAllInvoices(@Query('store') store?: string) {
    try {
      this.logger.log(`🧾 Getting invoices for store: ${store}`);
      
      if (!store) {
        throw new BadRequestException('El parámetro "store" es requerido');
      }

      if (!this.storeCredentialsService.isValidStore(store)) {
        throw new BadRequestException(`Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`);
      }

      const result = await this.invoicesService.getCachedInvoices(store);
      this.logger.log(`✅ Invoices retrieved for ${store}: ${result?.data?.length || 0} items`);
      
      // Si no hay datos, intentar cargar
      if (result.data.length === 0 && !result.updating) {
        this.logger.log(`🔄 No data found for ${store}, triggering initial load...`);
        // Forzar carga inicial en el background
        this.invoicesService.updateInvoicesManually(store).catch(error => {
          this.logger.error(`Error in background load for ${store}:`, error);
        });
      }
      
      return result;
    } catch (error) {
      this.logger.error(`❌ Error getting invoices for store ${store}:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(`Error al obtener facturas para la tienda ${store}: ${error.message}`);
    }
  }

   @Get('update')
  async updateInvoices(@Query('store') store?: string) {
    if (!store) {
      throw new BadRequestException('El parámetro "store" es requerido');
    }

    if (!this.storeCredentialsService.isValidStore(store)) {
      throw new BadRequestException(`Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`);
    }

    await this.invoicesService.updateInvoicesManually(store);
    return this.invoicesService.getCachedInvoices(store);
  }

  @Get('reload')
  async reloadInvoices(@Query('store') store?: string) {
    if (!store) {
      throw new BadRequestException('El parámetro "store" es requerido');
    }

    if (!this.storeCredentialsService.isValidStore(store)) {
      throw new BadRequestException(`Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`);
    }

    await this.invoicesService.clearCacheAndReload(store);
    return this.invoicesService.getCachedInvoices(store);
  }

  @Get('ensure-full-persistence')
  async ensureFullPersistence(@Query('store') store?: string) {
    if (!store) {
      throw new BadRequestException('El parámetro "store" es requerido');
    }

    if (!this.storeCredentialsService.isValidStore(store)) {
      throw new BadRequestException(`Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`);
    }

    await this.invoicesService.ensureFullDataPersistence(store);
    return { message: `Persistencia completa asegurada para facturas de ${store}` };
  }
}