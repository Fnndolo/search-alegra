import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoreCredentialsService } from '../shared/store-credentials.service';
import { WebhookEvent } from './webhook-subscription.interface';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly storeCredentialsService: StoreCredentialsService
  ) { }

  async subscribeToEvents(store: string) {
    const credentials = this.storeCredentialsService.getCredentials(store);
    const webhookUrl = this.configService.get<string>('WEBHOOK_BASE_URL');

    if (!webhookUrl) {
      throw new Error('WEBHOOK_BASE_URL not configured');
    }

    const events: WebhookEvent[] = [
      'new-invoice',
      'edit-invoice',
      'new-bill',
      'edit-bill'
    ];

    this.logger.log(`Starting webhook registration for ${store}`);

    try {
      // Registrar todos los eventos
      for (const event of events) {
        // Construir URL sin protocolo para cada tienda
        const finalUrl = `${webhookUrl}/${store}`;
        
        const subscription = {
          event: event,
          url: finalUrl
        };

        this.logger.log(`URL formateada para Alegra: ${finalUrl}`);

        this.logger.log(`Registrando webhook para ${store} - evento: ${event}`);
        this.logger.log(`URL final del webhook: ${finalUrl}`);
        this.logger.log(`Cuerpo completo de la petición:`, JSON.stringify(subscription, null, 2));
        this.logger.log(`URL del webhook: ${subscription.url}`);
        this.logger.log(`Cuerpo de la petición: ${JSON.stringify(subscription, null, 2)}`);
        this.logger.log(`API Key (original): ${credentials.apiKey}`);
        this.logger.log(`API Key (base64): ${Buffer.from(credentials.apiKey).toString('base64')}`);

        const response = await fetch('https://api.alegra.com/api/v1/webhooks/subscriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(credentials.apiKey).toString('base64')}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(subscription)
        });

        const responseText = await response.text();
        if (!response.ok) {
          this.logger.error(`Error registering webhook for ${event}:`);
          this.logger.error(`Status: ${response.status} ${response.statusText}`);
          this.logger.error(`Response: ${responseText}`);
          throw new Error(`Error registering webhook: ${responseText}`);
        }

        const result = JSON.parse(responseText);
        this.logger.log(`✅ Webhook subscription created for ${store} - ${event}: ${JSON.stringify(result)}`);
      }

      return { success: true, message: `All webhooks registered for ${store}` };
    } catch (error) {
      this.logger.error(`Failed to subscribe to events for ${store}: ${error.message}`);
      throw error;
    }
  }
}
