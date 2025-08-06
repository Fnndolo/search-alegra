import { Controller, Get } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get('all')
  getAllInvoices() {
    return this.invoicesService.getCachedInvoices();
  }

   @Get('update')
  async updateInvoices() {
    await this.invoicesService.updateInvoicesManually();
    return this.invoicesService.getCachedInvoices();
  }
}