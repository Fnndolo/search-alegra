import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { StoreCredentialsService } from '../shared/store-credentials.service';

@Injectable()
export class WebhooksInitializer implements OnApplicationBootstrap {
  private readonly logger = new Logger(WebhooksInitializer.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly storeCredentialsService: StoreCredentialsService,
  ) {}

  async onApplicationBootstrap() {
    this.logger.log('Initializing webhooks...');
    
    try {
      // Obtener todas las tiendas
      const stores = this.storeCredentialsService.getAllValidStores();
      
      // Registrar webhooks para cada tienda
      for (const store of stores) {
        try {
          await this.webhooksService.subscribeToEvents(store);
          this.logger.log(`Successfully registered webhooks for ${store}`);
        } catch (error) {
          this.logger.error(`Failed to register webhooks for ${store}: ${error.message}`);
        }
      }
      
      this.logger.log('Webhook initialization completed');
    } catch (error) {
      this.logger.error('Error during webhook initialization:', error);
    }
  }
}