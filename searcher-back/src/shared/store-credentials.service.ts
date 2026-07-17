import { Injectable, BadRequestException } from '@nestjs/common';
const { getStoreCredentials, getStoreApiKey } = require('../../config');

export interface StoreCredentials {
  apiKey: string;
  invoicesApiUrl: string;
  billsApiUrl: string;
}

@Injectable()
export class StoreCredentialsService {
  private readonly storeCredentials: Map<string, StoreCredentials> = new Map();

  constructor() {
    this.initializeStoreCredentials();
  }

  private initializeStoreCredentials() {
    for (const store of ['pasto', 'medellin', 'armenia', 'pereira', 'bogota']) {
      const credentials = getStoreCredentials(store);
      this.storeCredentials.set(store, {
        apiKey: credentials.apiKey || getStoreApiKey(store),
        invoicesApiUrl: credentials.alegraApiUrl,
        billsApiUrl: credentials.alegraBillsApiUrl,
      });
    }
  }

  getCredentials(store: string): StoreCredentials {
    const normalizedStore = store?.toLowerCase();
    
    if (!this.isValidStore(normalizedStore)) {
      throw new BadRequestException(
        `Tienda inválida: ${store}. Las tiendas válidas son: pasto, medellin, armenia, pereira, bogota, todas`
      );
    }

    const credentials = this.storeCredentials.get(normalizedStore);
    if (!credentials) {
      throw new BadRequestException(`No se encontraron credenciales para la tienda: ${store}`);
    }

    // Evitar el footgun de usar la API key de otra tienda: si la sede no tiene su PROPIA
    // key configurada, fallar claramente en vez de caer a ALEGRA_API_KEY (cuenta de Pasto)
    // y terminar cargando datos de Pasto bajo otra sede.
    if (!credentials.apiKey) {
      throw new BadRequestException(
        `No hay API key configurada para la tienda "${store}". Configure ${normalizedStore.toUpperCase()}_API_KEY en el entorno (Railway).`
      );
    }

    return credentials;
  }

  isValidStore(store: string): boolean {
    const validStores = ['pasto', 'medellin', 'armenia', 'pereira', 'bogota', 'todas'];
    return validStores.includes(store?.toLowerCase());
  }

  getStoreDisplayName(store: string): string {
    const storeNames = {
      'pasto': 'Smart Gadgets Pasto',
      'medellin': 'Smart Gadgets Medellín',
      'armenia': 'Smart Gadgets Armenia',
      'pereira': 'Smart Gadgets Pereira',
      'bogota': 'Smart Gadgets Bogotá',
      'todas': 'Todas las tiendas'
    };
    
    return storeNames[store?.toLowerCase()] || store;
  }

  getAllValidStores(): string[] {
    return ['pasto', 'medellin', 'armenia', 'pereira', 'bogota', 'todas'];
  }

  getAllPhysicalStores(): string[] {
    return ['pasto', 'medellin', 'armenia', 'pereira', 'bogota'];
  }
}
