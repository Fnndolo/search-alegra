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

  // Snapshot de lo cargado, para guardar SOLO el diff (nuevo/modificado/eliminado).
  private originalSnapshot = new Map<string, string>();

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
      this.snapshotMappings(mappingsRes || []);
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

  private serializeRow(r: ProductMappingRow): string {
    return JSON.stringify({
      kupoProductId: r.kupoProductId, kupoProductName: r.kupoProductName,
      namePasto: r.namePasto, nameArmenia: r.nameArmenia, namePereira: r.namePereira,
      nameMedellin: r.nameMedellin, nameBogota: r.nameBogota,
    });
  }

  private snapshotMappings(rows: ProductMappingRow[]) {
    this.originalSnapshot.clear();
    for (const r of rows) if (r.id) this.originalSnapshot.set(r.id, this.serializeRow(r));
  }

  async saveMappings() {
    const rows = this.mappings();
    // Diff: solo filas nuevas (sin id) o modificadas respecto a lo cargado.
    const upserts = rows.filter(r => !r.id || this.originalSnapshot.get(r.id) !== this.serializeRow(r));
    const currentIds = new Set(rows.filter(r => r.id).map(r => r.id as string));
    const deletedIds = [...this.originalSnapshot.keys()].filter(id => !currentIds.has(id));

    // Validar SOLO las filas que se van a guardar.
    const invalidRows = upserts.filter(m => !m.kupoProductId);
    if (invalidRows.length > 0) {
      this.messageService.add({ severity: 'warn', summary: 'Atención', detail: 'Las filas a guardar deben tener un producto de Kupocell seleccionado' });
      return;
    }
    if (upserts.length === 0 && deletedIds.length === 0) {
      this.messageService.add({ severity: 'info', summary: 'Sin cambios', detail: 'No hay cambios para guardar' });
      return;
    }

    this.saving.set(true);
    try {
      const res: any = await this.billingService.saveProductMappings(upserts, deletedIds).toPromise();
      // Asignar EN SITIO los ids generados a las filas nuevas (mismo orden que upserts), SIN recargar
      // ni reemplazar el arreglo -> no se re-renderiza toda la tabla -> no se traba al guardar.
      const saved = res?.saved || [];
      for (let i = 0; i < upserts.length; i++) {
        if (saved[i]?.id) upserts[i].id = saved[i].id;
      }
      this.snapshotMappings(this.mappings());
      this.messageService.add({ severity: 'success', summary: 'Guardado', detail: `Cambios guardados (${upserts.length} guardado(s), ${deletedIds.length} eliminado(s))` });
    } catch (error) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron guardar los mapeos' });
    } finally {
      this.saving.set(false);
    }
  }
}
