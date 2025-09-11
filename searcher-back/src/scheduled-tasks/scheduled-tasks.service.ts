import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cron from 'node-cron';
import { Invoice } from '../entities/invoice.entity';
import { Bill } from '../entities/bill.entity';
import { InvoicesService } from '../invoices/invoices.service';
import { BillsService } from '../bills/bills.service';
import { StoreCredentialsService } from '../shared/store-credentials.service';

@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(Bill)
    private readonly billRepository: Repository<Bill>,
    private readonly invoicesService: InvoicesService,
    private readonly billsService: BillsService,
    private readonly storeCredentialsService: StoreCredentialsService,
  ) {
    // Iniciar las tareas programadas
    this.initScheduledTasks();
  }

  private initScheduledTasks() {
    // Programar para las 13:00 hora Colombia (18:00 UTC)
    cron.schedule('0 18 * * *', () => {
      this.logger.log('Iniciando sincronización programada de las 13:00');
      this.syncAllData();
    });

    // Programar para las 20:00 hora Colombia (01:00 UTC del día siguiente)
    cron.schedule('0 1 * * *', () => {
      this.logger.log('Iniciando sincronización programada de las 20:00');
      this.syncAllData();
    });
  }

  private async syncAllData() {
    try {
      const stores = this.storeCredentialsService.getAllValidStores();
      
      // 1. Eliminar todos los datos existentes
      this.logger.log('Eliminando datos existentes...');
      await this.invoiceRepository.clear();
      await this.billRepository.clear();
      
      // 2. Sincronizar facturas y bills para cada tienda
      for (const store of stores) {
        this.logger.log(`Iniciando sincronización completa para ${this.storeCredentialsService.getStoreDisplayName(store)}`);
        
        try {
          // Sincronizar facturas
          await this.invoicesService.loadAllInvoicesFromAPI(store);
          this.logger.log(`✅ Facturas sincronizadas exitosamente para ${store}`);
          
          // Sincronizar bills
          await this.billsService.loadAllBillsFromAPI(store);
          this.logger.log(`✅ Bills sincronizadas exitosamente para ${store}`);
        } catch (error) {
          this.logger.error(`❌ Error sincronizando datos para ${store}:`, error);
          // Continuar con la siguiente tienda incluso si hay error
          continue;
        }
      }
      
      this.logger.log('✅ Sincronización completa finalizada exitosamente');
    } catch (error) {
      this.logger.error('❌ Error en la sincronización programada:', error);
    }
  }
}
