import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface StoreCredentials {
  apiKey: string;
  invoicesApiUrl: string;
  billsApiUrl: string;
}

@Injectable()
export class StoreCredentialsService {
  private readonly storeCredentials: Map<string, StoreCredentials> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.initializeStoreCredentials();
  }

  private initializeStoreCredentials() {
    // Credenciales para cada tienda
    this.storeCredentials.set('pasto', {
      apiKey: (this.configService.get<string>('PASTO_API_KEY') || this.configService.get<string>('ALEGRA_API_KEY')) as string,
      invoicesApiUrl: (this.configService.get<string>('ALEGRA_API_URL_PASTO') || this.configService.get<string>('ALEGRA_API_URL')) as string,
      billsApiUrl: (this.configService.get<string>('ALEGRA_BILLS_API_URL_PASTO') || this.configService.get<string>('ALEGRA_BILLS_API_URL')) as string,
    });

    this.storeCredentials.set('medellin', {
      apiKey: (this.configService.get<string>('ALEGRA_API_KEY')) as string,
      invoicesApiUrl: (this.configService.get<string>('ALEGRA_API_URL')) as string,
      billsApiUrl: (this.configService.get<string>('ALEGRA_BILLS_API_URL')) as string,
    });

    this.storeCredentials.set('armenia', {
      apiKey: (this.configService.get<string>('ARMENIA_API_KEY') || this.configService.get<string>('ALEGRA_API_KEY')) as string,
      invoicesApiUrl: (this.configService.get<string>('ALEGRA_API_URL_ARMENIA') || this.configService.get<string>('ALEGRA_API_URL')) as string,
      billsApiUrl: (this.configService.get<string>('ALEGRA_BILLS_API_URL_ARMENIA') || this.configService.get<string>('ALEGRA_BILLS_API_URL')) as string,
    });

    this.storeCredentials.set('pereira', {
      apiKey: (this.configService.get<string>('PEREIRA_API_KEY') || this.configService.get<string>('ALEGRA_API_KEY')) as string,
      invoicesApiUrl: (this.configService.get<string>('ALEGRA_API_URL_PEREIRA') || this.configService.get<string>('ALEGRA_API_URL')) as string,
      billsApiUrl: (this.configService.get<string>('ALEGRA_BILLS_API_URL_PEREIRA') || this.configService.get<string>('ALEGRA_BILLS_API_URL')) as string,
    });
  }

  getCredentials(store: string): StoreCredentials {
    const normalizedStore = store?.toLowerCase();
    
    if (!this.isValidStore(normalizedStore)) {
      throw new BadRequestException(
        `Tienda inválida: ${store}. Las tiendas válidas son: pasto, medellin, armenia, pereira`
      );
    }

    const credentials = this.storeCredentials.get(normalizedStore);
    if (!credentials) {
      throw new BadRequestException(`No se encontraron credenciales para la tienda: ${store}`);
    }

    return credentials;
  }

  isValidStore(store: string): boolean {
    const validStores = ['pasto', 'medellin', 'armenia', 'pereira'];
    return validStores.includes(store?.toLowerCase());
  }

  getStoreDisplayName(store: string): string {
    const storeNames = {
      'pasto': 'Smart Gadgets Pasto',
      'medellin': 'Smart Gadgets Medellín',
      'armenia': 'Smart Gadgets Armenia',
      'pereira': 'Smart Gadgets Pereira'
    };
    
    return storeNames[store?.toLowerCase()] || store;
  }

  getAllValidStores(): string[] {
    return ['pasto', 'medellin', 'armenia', 'pereira'];
  }
}
