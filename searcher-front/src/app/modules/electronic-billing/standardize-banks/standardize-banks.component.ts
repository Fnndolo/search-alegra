import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';
import { ElectronicBillingService } from '../services/electronic-billing.service';

export interface BankMappingRow {
    id?: string;
    kupoBankId: string;
    kupoBankName: string;
    namePasto: string;
    nameArmenia: string;
    namePereira: string;
    nameMedellin: string;
    nameBogota: string;
}

@Component({
    selector: 'app-standardize-banks',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        TableModule,
        DropdownModule,
        InputTextModule,
        ButtonModule,
        ToastModule,
        TooltipModule
    ],
    providers: [MessageService],
    templateUrl: './standardize-banks.component.html',
    styleUrl: './standardize-banks.component.scss'
})
export class StandardizeBanksComponent implements OnInit {

    mappings = signal<BankMappingRow[]>([]);
    kupoBanks = signal<{ id: string, name: string }[]>([]);

    loadingBanks = signal<boolean>(false);
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
        this.loadingBanks.set(true);
        this.loadingMappings.set(true);

        try {
            const banksRes = await this.billingService.getKupocellBanks().toPromise();
            this.kupoBanks.set(banksRes || []);
        } catch (error) {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo cargar el catálogo de bancos de Kupocell' });
        } finally {
            this.loadingBanks.set(false);
        }

        try {
            const mappingsRes = await this.billingService.getBankMappings().toPromise();
            this.mappings.set(mappingsRes || []);
            this.snapshotMappings(mappingsRes || []);
        } catch (error) {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron cargar los mapeos de bancos' });
        } finally {
            this.loadingMappings.set(false);
        }
    }

    onBankSelect(event: any, row: BankMappingRow) {
        const selectedId = event.value;
        const bank = this.kupoBanks().find(b => b.id === selectedId);
        if (bank) {
            row.kupoBankName = bank.name;
        }
    }

    addRow() {
        this.mappings.update(m => [...m, {
            kupoBankId: '',
            kupoBankName: '',
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
        this.loadingBanks.set(true);
        try {
            const banksRes = await this.billingService.getKupocellBanks(true).toPromise();
            this.kupoBanks.set(banksRes || []);
            this.messageService.add({ severity: 'success', summary: 'Sincronizado', detail: `Se encontraron ${banksRes?.length || 0} cuentas bancarias en Kupocell` });
        } catch (error) {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo sincronizar el catálogo de bancos' });
        } finally {
            this.loadingBanks.set(false);
        }
    }

    private serializeRow(r: BankMappingRow): string {
        return JSON.stringify({
            kupoBankId: r.kupoBankId, kupoBankName: r.kupoBankName,
            namePasto: r.namePasto, nameArmenia: r.nameArmenia, namePereira: r.namePereira,
            nameMedellin: r.nameMedellin, nameBogota: r.nameBogota,
        });
    }

    private snapshotMappings(rows: BankMappingRow[]) {
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
        const invalidRows = upserts.filter(m => !m.kupoBankId || (!m.namePasto && !m.nameArmenia && !m.namePereira && !m.nameMedellin && !m.nameBogota));
        if (invalidRows.length > 0) {
            this.messageService.add({ severity: 'warn', summary: 'Atención', detail: 'Las filas a guardar deben tener un banco de Kupocell y al menos un nombre de sede origen' });
            return;
        }
        if (upserts.length === 0 && deletedIds.length === 0) {
            this.messageService.add({ severity: 'info', summary: 'Sin cambios', detail: 'No hay cambios para guardar' });
            return;
        }

        this.saving.set(true);
        try {
            await this.billingService.saveBankMappings(upserts, deletedIds).toPromise();
            this.messageService.add({ severity: 'success', summary: 'Guardado', detail: `Cambios guardados (${upserts.length} guardado(s), ${deletedIds.length} eliminado(s))` });

            const mappingsRes = await this.billingService.getBankMappings().toPromise();
            this.mappings.set(mappingsRes || []);
            this.snapshotMappings(mappingsRes || []);
        } catch (error) {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudieron guardar los mapeos de bancos' });
        } finally {
            this.saving.set(false);
        }
    }
}
