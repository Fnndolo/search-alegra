import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoreCredentialsService } from '../shared/store-credentials.service';
import { BillsDbService } from './bills.service.db';

@Injectable()
export class BillsService {
  private readonly logger = new Logger(BillsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly storeCredentialsService: StoreCredentialsService,
    private readonly billsDbService: BillsDbService,
  ) {}

  /**
   * Actualiza las bills manualmente para una tienda específica.
   */
  async updateBillsManually(store: string) {
    return await this.billsDbService.updateBillsManually(store);
  }

  /**
   * Carga todas las bills desde la API
   */
  async loadAllBillsFromAPI(store: string): Promise<void> {
    return await this.billsDbService.ensureFullDataPersistence(store);
  }

  /**
   * Obtiene las bills en caché para una tienda específica.
   */
  async getCachedBills(store: string) {
    return await this.billsDbService.getCachedBills(store);
  }
}
