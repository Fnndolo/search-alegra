import { Controller, Post, Body, Param, Logger, HttpCode } from '@nestjs/common';
import { InvoicesService } from '../invoices/invoices.service';
import { BillsService } from '../bills/bills.service';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly billsService: BillsService
  ) {}

  @Post(':store')
  @HttpCode(200)
  async handleWebhook(
    @Param('store') store: string,
    @Body() payload: any
  ) {
    this.logger.log(`Received webhook for ${store}: ${JSON.stringify(payload)}`);

    try {
      // Verificación inicial de Alegra - envía body vacío o sin propiedades
      if (!payload || Object.keys(payload).length === 0 || !payload.subject) {
        this.logger.log(`Webhook verification request from Alegra for ${store}`);
        return { status: 'ok' };
      }

      // Manejar el formato real de Alegra
      // Alegra envía: { subject: "new-invoice", message: { invoice: {...} } }
      const { subject, message } = payload;

      if (!subject || !message) {
        this.logger.warn('Invalid webhook payload format');
        return { status: 'ok' }; // Responder OK de todas formas
      }

      // Extraer el tipo de evento y el ID
      let entityType: string | undefined;
      let entityId: string | undefined;

      if (subject.includes('invoice')) {
        entityType = 'invoice';
        entityId = message.invoice?.id;
      } else if (subject.includes('bill')) {
        entityType = 'bill';
        entityId = message.bill?.id;
      }

      if (!entityId || !entityType) {
        this.logger.warn(`No entity ID or type found in webhook payload for ${subject}`);
        return { status: 'ok' };
      }

      this.logger.log(`Processing ${subject} for ${entityType} ${entityId} in store ${store}`);

      // Procesar según el tipo de entidad
      switch (entityType) {
        case 'invoice':
          await this.invoicesService.updateSingleInvoice(store, entityId);
          this.logger.log(`✅ Successfully processed invoice ${entityId} for ${store}`);
          break;

        case 'bill':
          await this.billsService.updateSingleBill(store, entityId);
          this.logger.log(`✅ Successfully processed bill ${entityId} for ${store}`);
          break;

        default:
          this.logger.warn(`Unhandled entity type: ${entityType}`);
      }

      return { status: 'ok' };
    } catch (error) {
      this.logger.error(`Error processing webhook: ${error.message}`);
      // Siempre devolver 200 OK para evitar que Alegra desactive el webhook
      return { status: 'ok', error: error.message };
    }
  }
}