import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Logger,
  HttpCode,
  HttpException,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../entities/user.entity';
import { InventoryStockService } from './services/inventory-stock.service';
import { InvoicesService } from '../../invoices/invoices.service';

// Logs non-HttpException errors here (their only touchpoint before leaving the controller layer),
// then rethrows the ORIGINAL error untouched — flattening it into a bare 500 HttpException here
// would strip its real type (QueryFailedError, axios error, ...) before AllExceptionsFilter ever
// gets a chance to decode it into a real status/message.
function rethrow(err: unknown, logger: Logger, context: string): never {
  if (!(err instanceof HttpException)) {
    const msg = (err as any)?.message ?? 'Internal server error';
    logger.error(`[SaleSyncLogsController] ${context}: ${msg}`, (err as any)?.stack);
  }
  throw err;
}

/**
 * Sale-side counterpart of `PurchaseOrdersController`'s sync-logs/retry-inventory — surfaces
 * `SaleSyncIssue` rows created by `InventoryStockService.processInvoiceSale` when an Alegra
 * invoice line couldn't be auto-discounted (no mapping, IMEI mismatch, multi-variant fungible
 * product, etc.), and lets an admin retry it once the underlying data is fixed (mapping created,
 * IMEI corrected in Alegra, variant reduced to one, ...).
 */
@Controller('inventory/sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SaleSyncLogsController {
  private readonly logger = new Logger(SaleSyncLogsController.name);

  constructor(
    private readonly stockService: InventoryStockService,
    private readonly invoicesService: InvoicesService,
  ) {}

  @Get('sync-logs')
  @Roles(UserRole.ADMIN, UserRole.FACTURACION)
  async getSyncLogs(@Query('store') store?: string) {
    try {
      return await this.stockService.getSaleSyncIssues(store?.trim() || undefined);
    } catch (err) {
      rethrow(err, this.logger, 'getSyncLogs');
    }
  }

  @Post(':invoiceId/retry')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  async retry(
    @Param('invoiceId') invoiceId: string,
    @Query('store') storeQuery?: string,
    @Body() body?: { store?: string },
  ) {
    try {
      const store = (storeQuery?.trim() || body?.store?.trim()) ?? '';
      if (!store) {
        throw new BadRequestException('store is required (as query param or body)');
      }

      // Re-fetch the invoice from Alegra (same call the `new`/`edit` webhook makes) and re-run
      // the discount — units/mappings created since the original failure now resolve normally,
      // and `processInvoiceSale` auto-marks the matching `SaleSyncIssue` rows as resolved.
      const invoiceData = await this.invoicesService.updateSingleInvoice(store, invoiceId);
      await this.stockService.processInvoiceSale(store, invoiceData);

      const remaining = await this.stockService.getSaleSyncIssues(store);
      return remaining.filter((issue) => issue.alegra_invoice_id === invoiceId);
    } catch (err) {
      rethrow(err, this.logger, 'retry');
    }
  }
}
