import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { StoreCredentialsService } from '../../../shared/store-credentials.service';

const ALEGRA_BASE_URL = 'https://api.alegra.com/api/v1';

@Injectable()
export class InventoryAlegraFactory {
  private readonly logger = new Logger(InventoryAlegraFactory.name);
  private readonly clients = new Map<string, AxiosInstance>();

  constructor(private readonly storeCredentials: StoreCredentialsService) {}

  getClient(storeKey: string): AxiosInstance {
    const key = storeKey.toLowerCase();

    if (this.clients.has(key)) {
      return this.clients.get(key)!;
    }

    const creds = this.storeCredentials.getCredentials(key);
    const base64 = Buffer.from(creds.apiKey).toString('base64');

    const client = axios.create({
      baseURL: ALEGRA_BASE_URL,
      timeout: 30000, // avoid hanging forever if Alegra stops responding
      headers: {
        Authorization: `Basic ${base64}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    this.clients.set(key, client);
    this.logger.log(`[InventoryAlegraFactory] Created Axios client for store: ${key}`);
    return client;
  }

  /**
   * Execute an Axios call with linear 429-backoff retry.
   * Only retries on HTTP 429; all other errors bubble up immediately.
   */
  async requestWithRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 429 && attempt < maxRetries) {
          const delay = (attempt + 1) * 1500;
          this.logger.warn(
            `[InventoryAlegraFactory] 429 rate-limit — retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
    throw new Error('requestWithRetry: exceeded max retries');
  }
}
