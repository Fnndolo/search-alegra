import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { ElectronicBillingService } from '../services/electronic-billing.service';

export interface ProductMappingRow {
  id?: string;
  kupoProductId: string;
  kupoProductName: string;
  namePasto: string;
  nameArmenia: string;
  namePereira: string;
  nameMedellin: string;
  nameBogota: string;
}

@Component({
  selector: 'app-standardize-items',
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    DropdownModule,
    InputTextModule,
    ButtonModule,
    ToastModule
  ],
  providers: [MessageService],
  templateUrl: './standardize-items.component.html',
  styleUrl: './standardize-items.component.scss'
})
export class StandardizeItemsComponent implements OnInit {

  mappings = signal<ProductMappingRow[]>([]);
  kupoProducts = signal<{ id: string, name: string }[]>([]);

  loadingProducts = signal<boolean>(false);
  loadingMappings = signal<boolean>(false);
  saving = signal<boolean>(false);

  constructor(
    private billingService: ElectronicBillingService,
    private messageService: MessageService
  ) { }

  ngOnInit() {
    this.loadData();
  }

  async loadData() {
    this.loadingProducts.set(true);
    this.loadingMappings.set(true);

    try {
      const productsRes = await this.billingService.getKupocellProducts().toPromise();
      this.kupoProducts.set(productsRes || []);
    } catch (error) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo cargar el catálogo de Kupocell' });
    } finally {
      this.loadingProducts.set(false);
    }

    try {
      const mappingsRes = await this.billingService.getProductMappings().toPromise();
      this.mappings.set(mappingsRes || []);
    } catch (error) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar los mapeos guardados' });
    } finally {
      this.loadingMappings.set(false);
    }
  }

  onProductSelect(event: any, row: ProductMappingRow) {
    const selectedId = event.value;
    const product = this.kupoProducts().find(p => p.id === selectedId);
    if (product) {
      row.kupoProductName = product.name;
    }
  }

  addRow() {
    this.mappings.update(m => [...m, {
      kupoProductId: '',
      kupoProductName: '',
      namePasto: '',
      nameArmenia: '',
      namePereira: '',
      nameMedellin: '',
      nameBogota: ''
    }]);
  }

  deleteRow(index: number) {
    this.mappings.update(m => m.filter((_, i) => i !== index));
  }

  async syncCatalog() {
    this.loadingProducts.set(true);
    try {
      const productsRes = await this.billingService.getKupocellProducts(true).toPromise();
      this.kupoProducts.set(productsRes || []);
      this.messageService.add({ severity: 'success', summary: 'Sincronizado', detail: `Se encontraron ${productsRes?.length || 0} productos en Kupocell` });
    } catch (error) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo sincronizar el catálogo' });
    } finally {
      this.loadingProducts.set(false);
    }
  }

  async saveMappings() {
    const invalidRows = this.mappings().filter(m => !m.kupoProductId);
    if (invalidRows.length > 0) {
      this.messageService.add({ severity: 'warn', summary: 'Atención', detail: 'Todas las filas deben tener un producto de Kupocell seleccionado' });
      return;
    }

    this.saving.set(true);
    try {
      await this.billingService.saveProductMappings(this.mappings()).toPromise();
      this.messageService.add({ severity: 'success', summary: 'Guardado', detail: 'Los mapeos se han guardado correctamente' });

      const mappingsRes = await this.billingService.getProductMappings().toPromise();
      this.mappings.set(mappingsRes || []);
    } catch (error) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron guardar los mapeos' });
    } finally {
      this.saving.set(false);
    }
  }
}
