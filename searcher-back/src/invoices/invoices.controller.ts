import { Controller, Get, Query, BadRequestException, Logger, InternalServerErrorException, UseGuards } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesDetailService } from './invoices-detail.service';
import { StoreCredentialsService } from '../shared/store-credentials.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../entities/user.entity';

@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.USUARIO, UserRole.FACTURACION, UserRole.COMPRAS)
export class InvoicesController {
  private readonly logger = new Logger(InvoicesController.name);

  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicesDetailService: InvoicesDetailService,
    private readonly storeCredentialsService: StoreCredentialsService,
  ) {}

  /**
   * Valida que la tienda exista y sea una sede concreta (no el agregado "todas"),
   * que es lo que necesitan las operaciones sobre un documento puntual.
   */
  private assertPhysicalStore(store?: string): string {
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

  @Get('detail')
  async getInvoiceDetail(@Query('store') store: string, @Query('id') id: string) {
    const validStore = this.assertPhysicalStore(store);
    if (!id) {
      throw new BadRequestException('El parámetro "id" es requerido');
    }
    return this.invoicesDetailService.getInvoiceDetail(validStore, id);
  }

  @Get('company')
  async getCompany(@Query('store') store: string) {
    return this.invoicesDetailService.getCompany(this.assertPhysicalStore(store));
  }

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
      
      // Si no hay datos y no es "todas", intentar cargar
      if (result.data.length === 0 && !result.updating && store?.toLowerCase() !== 'todas') {
        // Forzar carga inicial en el background
        this.invoicesService.updateInvoicesManually(store).catch(error => {
        });
      }
      
      return result;
    } catch (error) {
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

    if (store?.toLowerCase() === 'todas') {
      throw new BadRequestException('No se puede actualizar manualmente "todas" las tiendas. Por favor, actualiza cada tienda individualmente.');
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

    if (store?.toLowerCase() === 'todas') {
      throw new BadRequestException('No se puede recargar "todas" las tiendas. Por favor, recarga cada tienda individualmente.');
    }

    await this.invoicesService.clearCacheAndReload(store);
    return this.invoicesService.getCachedInvoices(store);
  }

  @Get('sync-missing-payments')
  async syncMissingPayments(@Query('store') store?: string) {
    if (!store) {
      throw new BadRequestException('El parámetro "store" es requerido');
    }

    if (!this.storeCredentialsService.isValidStore(store)) {
      throw new BadRequestException(`Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`);
    }

    if (store?.toLowerCase() === 'todas') {
      const stores = this.storeCredentialsService.getAllPhysicalStores();
      await Promise.all(stores.map(s => this.invoicesService.syncMissingPayments(s)));
      return this.invoicesService.getAllStoresInvoices();
    } else {
      await this.invoicesService.syncMissingPayments(store);
      return this.invoicesService.getCachedInvoices(store);
    }
  }

  @Get('ensure-full-persistence')
  async ensureFullPersistence(@Query('store') store?: string) {
    if (!store) {
      throw new BadRequestException('El parámetro "store" es requerido');
    }

    if (!this.storeCredentialsService.isValidStore(store)) {
      throw new BadRequestException(`Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`);
    }

    if (store?.toLowerCase() === 'todas') {
      throw new BadRequestException('No se puede ejecutar "ensure-full-persistence" para "todas" las tiendas. Por favor, ejecuta para cada tienda individualmente.');
    }

    await this.invoicesService.ensureFullDataPersistence(store);
    return { message: `Persistencia completa asegurada para facturas de ${store}` };
  }

  @Get('reload-with-payments')
  async reloadWithPayments(@Query('store') store?: string) {
    if (!store) {
      throw new BadRequestException('El parámetro "store" es requerido');
    }

    if (!this.storeCredentialsService.isValidStore(store)) {
      throw new BadRequestException(`Tienda inválida: ${store}. Tiendas válidas: ${this.storeCredentialsService.getAllValidStores().join(', ')}`);
    }

    if (store?.toLowerCase() === 'todas') {
      throw new BadRequestException('No se puede recargar con pagos para "todas" las tiendas. Por favor, recarga cada tienda individualmente.');
    }

    // Iniciar el proceso en background
    this.invoicesService.reloadAllWithPayments(store).catch(error => {
      this.logger.error(`Error recargando facturas con pagos para ${store}:`, error);
    });

    return { 
      message: `Proceso de recarga iniciado para ${store}. Las facturas se están recargando con sus medios de pago.`,
      status: 'processing'
    };
  }
}