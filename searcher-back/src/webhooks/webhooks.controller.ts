import { Controller, Post, Body, Param, Logger, HttpCode, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { InvoicesService } from '../invoices/invoices.service';
import { BillsService } from '../bills/bills.service';
import { WebhooksService } from './webhooks.service';
import { WebsocketsGateway } from '../websockets/websockets.gateway';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly billsService: BillsService,
    private readonly webhooksService: WebhooksService,
    private readonly websocketsGateway: WebsocketsGateway,
  ) {}

  @Post(':store')
  async handleWebhook(
    @Param('store') store: string,
    @Body() payload: any,
    @Res() res: Response
  ) {
    // CLAVE: Responder INMEDIATAMENTE antes de hacer cualquier procesamiento
    // Esto asegura que Alegra reciba la respuesta en menos de 5 segundos
    res.status(200).json({ status: 'ok' });

    // Ahora procesar asíncronamente DESPUÉS de haber respondido
    setImmediate(async () => {
      try {
        this.logger.log(`Webhook received for ${store}: ${JSON.stringify(payload)}`);

        // Verificación inicial - payload vacío
        if (!payload || Object.keys(payload).length === 0 || !payload.subject) {
          this.logger.log(`Webhook verification from Alegra for ${store}`);
          return;
        }

        const { subject, message } = payload;

        if (!subject || !message) {
          this.logger.warn('Invalid webhook payload format');
          return;
        }

        // Extraer información
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
          this.logger.warn(`No entity ID or type found for ${subject}`);
          return;
        }

        this.logger.log(`Processing ${subject} for ${entityType} ${entityId} in ${store}`);

        // Procesar según el tipo
        switch (entityType) {
          case 'invoice':
            // Para delete, eliminar de DB y emitir evento
            if (subject.includes('delete')) {
              await this.invoicesService.deleteSingleInvoice(store, entityId);
              this.logger.log(`🗑️ Invoice ${entityId} deleted for ${store}`);
              this.websocketsGateway.emitInvoiceDeleted(store, entityId);
            } else {
              // Para new y edit, obtener datos y emitir
              const invoiceData = await this.invoicesService.updateSingleInvoice(store, entityId);
              this.logger.log(`✅ Invoice ${entityId} processed for ${store}`);
              
              if (subject.includes('new')) {
                this.websocketsGateway.emitInvoiceCreated(store, invoiceData);
              } else if (subject.includes('edit')) {
                this.websocketsGateway.emitInvoiceUpdated(store, invoiceData);
              }
            }
            break;

          case 'bill':
            // Para delete, eliminar de DB y emitir evento
            if (subject.includes('delete')) {
              await this.billsService.deleteSingleBill(store, entityId);
              this.logger.log(`🗑️ Bill ${entityId} deleted for ${store}`);
              this.websocketsGateway.emitBillDeleted(store, entityId);
            } else {
              // Para new y edit, obtener datos y emitir
              const billData = await this.billsService.updateSingleBill(store, entityId);
              this.logger.log(`✅ Bill ${entityId} processed for ${store}`);
              
              if (subject.includes('new')) {
                this.websocketsGateway.emitBillCreated(store, billData);
              } else if (subject.includes('edit')) {
                this.websocketsGateway.emitBillUpdated(store, billData);
              }
            }
            break;
        }
      } catch (error) {
        this.logger.error(`Error processing webhook: ${error.message}`);
      }
    });
  }

  // Endpoint para registrar webhooks manualmente
  @Get('register/:store')
  async registerWebhooks(@Param('store') store: string) {
    this.logger.log(`Manual webhook registration requested for ${store}`);
    try {
      const result = await this.webhooksService.subscribeToEvents(store);
      return result;
    } catch (error) {
      this.logger.error(`Error registering webhooks for ${store}: ${error.message}`);
      return { 
        success: false, 
        error: error.message,
        store: store
      };
    }
  }

  // Endpoint para verificar que el webhook está funcionando
  @Get('test/:store')
  @HttpCode(200)
  testWebhook(@Param('store') store: string) {
    this.logger.log(`Test webhook endpoint called for ${store}`);
    return { 
      status: 'ok', 
      message: `Webhook endpoint for ${store} is working`,
      timestamp: new Date().toISOString()
    };
  }
}