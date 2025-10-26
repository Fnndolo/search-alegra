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

  /**
   * Actualiza una cuenta por pagar individual por su ID
   */
  async updateSingleBill(store: string, billId: string): Promise<any> {
    return await this.billsDbService.updateSingleBill(store, billId);
  }

  /**
   * Obtiene una cuenta por pagar por su ID desde la base de datos
   */
  async getBillById(store: string, billId: string): Promise<any> {
    return await this.billsDbService.getBillById(store, billId);
  }

  /**
   * Elimina una cuenta por pagar de la base de datos
   */
  async deleteSingleBill(store: string, billId: string): Promise<void> {
    return await this.billsDbService.deleteSingleBill(store, billId);
  }
}
