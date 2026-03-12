import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import { InvoiceSyncLog, SyncStatus } from './entities/invoice-sync-log.entity';
import { ProductMapping } from '../entities/product-mapping.entity';
import { BankMapping } from '../entities/bank-mapping.entity';
import { KupoCatalogCache } from './entities/kupo-catalog-cache.entity';

// Mapeo de tiendas origen → bodega y centro de costo en Kupocell
const STORE_MAPPING: Record<string, { warehouseId: string, warehouseName: string, costCenterId: string, costCenterName: string }> = {
    'pasto': { warehouseId: '1', warehouseName: 'PASTO', costCenterId: '1', costCenterName: 'PRINCIPAL PASTO' },
    'medellin': { warehouseId: '019c66ef-e6a5-70e1-90c8-9bc2c422138d', warehouseName: 'MEDELLIN', costCenterId: '2', costCenterName: 'SEDE MEDELLIN' },
    'pereira': { warehouseId: '019c66f0-70fb-7698-8a0a-a86826df31dd', warehouseName: 'PEREIRA', costCenterId: '3', costCenterName: 'SEDE PEREIRA' },
    'armenia': { warehouseId: '019c66f0-a218-719b-8af0-36b2599476d9', warehouseName: 'ARMENIA', costCenterId: '4', costCenterName: 'SEDE ARMENIA' },
};

@Injectable()
export class ElectronicBillingService {
    private readonly logger = new Logger(ElectronicBillingService.name);
    private readonly alegraKupoApi: AxiosInstance;

    constructor(
        @InjectRepository(InvoiceSyncLog)
        private syncLogRepo: Repository<InvoiceSyncLog>,
        @InjectRepository(ProductMapping)
        private productMappingRepo: Repository<ProductMapping>,
        @InjectRepository(BankMapping)
        private bankMappingRepo: Repository<BankMapping>,
        @InjectRepository(KupoCatalogCache)
        private catalogCacheRepo: Repository<KupoCatalogCache>,
    ) {
        const kupoEmail = process.env.ALEGRA_KUPO_EMAIL || 'facturacionkupocell@gmail.com';
        const kupoToken = process.env.ALEGRA_KUPO_TOKEN || '4ea4a9d5447c6ca04d00';
        const authHeader = Buffer.from(`${kupoEmail}:${kupoToken}`).toString('base64');

        this.alegraKupoApi = axios.create({
            baseURL: 'https://api.alegra.com/api/v1',
            headers: {
                'Authorization': `Basic ${authHeader}`,
                'Accept': 'application/json'
            }
        });
    }

    // ─── Store Mapping ────────────────────────────────────────────

    getStoreMapping(store: string) {
        return STORE_MAPPING[store?.toLowerCase()] || null;
    }

    getAllStoreMappings() {
        return STORE_MAPPING;
    }

    // ─── Client Management ────────────────────────────────────────

    /**
     * Busca un cliente por número de identificación en la cuenta de Kupocell.
     * Si no existe, lo crea con los datos proporcionados.
     */
    async findOrCreateClient(clientData: {
        name: string;
        identification: string;
        identificationType?: string; // CC, NIT, CE, PA, etc.
        address?: string;
        city?: string;
        department?: string;
        phone?: string;
        email?: string;
    }): Promise<{ id: string; name: string; isNew: boolean }> {
        try {
            // 1. Buscar por identificación
            if (clientData.identification) {
                const searchResponse = await this.alegraKupoApi.get('/contacts', {
                    params: {
                        identification: clientData.identification,
                        limit: 1
                    }
                });

                const contacts = searchResponse.data;
                if (contacts && contacts.length > 0) {
                    this.logger.log(`✅ Cliente encontrado: ${contacts[0].name} (ID: ${contacts[0].id})`);
                    return {
                        id: contacts[0].id,
                        name: contacts[0].name,
                        isNew: false
                    };
                }
            }

            // 2. No encontrado, crear nuevo
            const nameParts = clientData.name.trim().split(/\s+/);
            let firstName: string;
            let lastName: string;

            if (nameParts.length <= 2) {
                firstName = nameParts[0] || clientData.name;
                lastName = nameParts.slice(1).join(' ') || '';
            } else {
                firstName = nameParts.slice(0, Math.ceil(nameParts.length / 2)).join(' ');
                lastName = nameParts.slice(Math.ceil(nameParts.length / 2)).join(' ');
            }

            // Tipo de identificación: usar el de la factura original, o CC por defecto
            const idType = clientData.identificationType || 'CC';

            // Separar nombre en 4 partes para nameObject de Alegra
            let firstN = '', secondN = '', lastN = '', secondLastN = '';
            if (nameParts.length === 1) {
                firstN = nameParts[0];
                lastN = nameParts[0];
            } else if (nameParts.length === 2) {
                firstN = nameParts[0];
                lastN = nameParts[1];
            } else if (nameParts.length === 3) {
                firstN = nameParts[0];
                lastN = nameParts[1];
                secondLastN = nameParts[2];
            } else {
                firstN = nameParts[0];
                secondN = nameParts[1];
                lastN = nameParts[2];
                secondLastN = nameParts.slice(3).join(' ');
            }

            const newContact: any = {
                name: clientData.name,
                identification: clientData.identification || '',
                identificationObject: {
                    type: idType,
                    number: clientData.identification || '',
                },
                type: 'client',
                kindOfPerson: 'PERSON_ENTITY',
                regime: 'SIMPLIFIED_REGIME',
                fiscalResponsabilities: [],
                nameObject: {
                    firstName: firstN,
                    secondName: secondN || undefined,
                    lastName: lastN,
                    secondLastName: secondLastN || undefined,
                },
                settings: {
                    sendElectronicDocuments: false,
                },
            };

            if (clientData.phone) {
                newContact.phonePrimary = clientData.phone;
                newContact.mobile = clientData.phone;
            }
            if (clientData.email) {
                newContact.email = clientData.email;
            }
            if (clientData.address || clientData.city || clientData.department) {
                newContact.address = { 
                    address: clientData.address || '',
                    city: clientData.city || '',
                    department: clientData.department || ''
                };
            }

            const createResponse = await this.alegraKupoApi.post('/contacts', newContact);
            const created = createResponse.data;

            this.logger.log(`🆕 Cliente creado: ${created.name} (ID: ${created.id})`);

            return {
                id: created.id,
                name: created.name,
                isNew: true
            };

        } catch (error) {
            const errorMsg = error.response?.data?.message || error.message;
            this.logger.error(`Error buscando/creando cliente: ${errorMsg}`);
            throw new Error(`Error con cliente "${clientData.name}": ${errorMsg}`);
        }
    }

    // ─── Invoice Creation ─────────────────────────────────────────

    /**
     * Crea una factura de venta en la cuenta de Kupocell.
     */
    async createKupocellInvoice(params: {
        clientId: string;
        items: { name: string; description?: string; price: number; quantity: number, applyIva?: boolean, taxRate?: number }[];
        warehouseId: string;
        costCenterId: string;
        applyIva: boolean;
        date: string;
        dueDate?: string;
        observations?: string;
        seller?: string;
        originalInvoiceId: string;
        originalStore: string;
        payments?: { bankName: string, amount: number }[];
        anotation?: string;
    }): Promise<{ success: boolean; invoiceId?: string; invoiceNumber?: string; error?: string; matchResults?: { name: string, matched: string | null }[] }> {
        try {
            // 1. Cargar el mapeo completo de la base de datos
            const mappings = await this.productMappingRepo.find();

            // Determinar la columna a buscar según la tienda original
            let storeColumnName = '';
            switch (params.originalStore.toLowerCase()) {
                case 'pasto': storeColumnName = 'namePasto'; break;
                case 'armenia': storeColumnName = 'nameArmenia'; break;
                case 'pereira': storeColumnName = 'namePereira'; break;
                case 'medellin': storeColumnName = 'nameMedellin'; break;
                default:
                    throw new Error(`Tienda origen desconocida: ${params.originalStore}`);
            }

            // 2. Matchear cada item EXTREMADAMENTE ESTRICTO contra la tabla de mapeo
            const invoiceItems: any[] = [];
            const matchResults: { name: string, matched: string | null }[] = [];

            for (const item of params.items) {
                // Buscar exactamente por el nombre textual y la columna de la tienda
                const match = mappings.find(m => m[storeColumnName]?.trim().toLowerCase() === item.name.trim().toLowerCase());

                if (!match) {
                    const errorMsg = `No se puede facturar: El producto '${item.name}' de la tienda ${params.originalStore.toUpperCase()} no está mapeado. Por favor, agregue el mapeo en Estandarizar Items.`;
                    this.logger.warn(errorMsg);
                    throw new Error(errorMsg); // Romper y lanzar a propósito
                }

                matchResults.push({
                    name: item.name,
                    matched: match.kupoProductName,
                });

                let scaledPrice = item.price;
                const is19 = params.applyIva || item.taxRate === 19 || item.applyIva;
                const is5 = item.taxRate === 5;
                const taxArr: { id: string }[] = [];

                if (is19) {
                    scaledPrice = item.price / 1.19;
                    taxArr.push({ id: '4' }); // IVA 19%
                } else if (is5) {
                    scaledPrice = item.price / 1.05;
                    taxArr.push({ id: '3' }); // IVA 5%
                }

                const invoiceItem: any = {
                    id: match.kupoProductId,
                    quantity: item.quantity,
                    price: scaledPrice,
                    description: item.description || '',
                    warehouse: { id: params.warehouseId },
                };

                // Solo agregar centro de costo si viene un ID válido
                if (params.costCenterId && params.costCenterId !== 'null' && params.costCenterId !== 'undefined') {
                    invoiceItem.costCenter = { id: params.costCenterId };
                }

                this.logger.log(`✅ Mapeo estricto: "${item.name}" → "${match.kupoProductName}" (ID: ${match.kupoProductId})`);

                if (taxArr.length > 0) {
                    invoiceItem.tax = taxArr;
                }

                invoiceItems.push(invoiceItem);
            }

            const invoicePayload: any = {
                client: { id: params.clientId },
                items: invoiceItems,
                date: params.date,
                dueDate: params.dueDate || params.date,
                warehouse: { id: params.warehouseId },
                paymentForm: 'CASH',
                paymentMethod: 'DEBIT_TRANSFER',
                observations: params.observations || undefined,
                anotation: params.anotation || undefined,
                status: 'open',
            };

            // Solo agregar centro de costo a nivel global si es necesario
            if (params.costCenterId && params.costCenterId !== 'null' && params.costCenterId !== 'undefined') {
                invoicePayload.costCenter = { id: params.costCenterId };
            }

            // 3. Asignar Numeración según tienda (IDs 16 al 19)
            let numberingId = '';
            switch (params.originalStore.toLowerCase()) {
                case 'pasto': numberingId = '16'; break;
                case 'medellin': numberingId = '17'; break;
                case 'armenia': numberingId = '18'; break;
                case 'pereira': numberingId = '19'; break;
            }

            if (numberingId) {
                invoicePayload.numberTemplate = { id: numberingId };
                this.logger.log(`🔢 Usando resolución de facturación ID: ${numberingId} para la tienda: ${params.originalStore}`);
            }

            // Asegurar que si no hay ni anotation ni observation, se envie la referencia básica
            if (!invoicePayload.observations && !invoicePayload.anotation) {
                invoicePayload.observations = `Factura origen: ${params.originalStore.toUpperCase()} #${params.originalInvoiceId}`;
            }

            this.logger.log(`📝 Creando factura Kupocell para cliente ${params.clientId}, ${invoiceItems.length} items...`);
            this.logger.debug(`Payload factura: ${JSON.stringify(invoicePayload, null, 2)}`);

            const response = await this.alegraKupoApi.post('/invoices', invoicePayload);
            const created = response.data;

            // Log de éxito
            await this.syncLogRepo.save({
                originalInvoiceId: `${params.originalStore}-${params.originalInvoiceId}`,
                kupoInvoiceId: String(created.id),
                status: SyncStatus.SUCCESS,
            });

            this.logger.log(`✅ Factura Kupocell creada: #${created.numberTemplate?.number || created.id}`);

            // 3. Procesar pagos si existen
            if (params.payments && params.payments.length > 0) {
                await this.processInvoicePayments(params.payments, String(created.id), params.date, params.originalStore);
            }

            return {
                success: true,
                invoiceId: String(created.id),
                invoiceNumber: created.numberTemplate?.number || String(created.id),
                matchResults,
            };

        } catch (error) {
            const errorMsg = error.response?.data?.message || error.message;
            this.logger.error(`❌ Error creando factura Kupocell: ${errorMsg}`);

            await this.syncLogRepo.save({
                originalInvoiceId: `${params.originalStore}-${params.originalInvoiceId}`,
                status: SyncStatus.FAILED,
                errorMessage: errorMsg,
            });

            return {
                success: false,
                error: errorMsg,
            };
        }
    }

    // ─── Mass Excel Processing ────────────────────────────────────

    async processMassExcelInvoices(invoices: any[]) {
        const results: { invoiceId: any; success: boolean; error: string; }[] = [];
        this.logger.log(`🚀 Iniciando facturación masiva de ${invoices.length} facturas desde Excel...`);

        // Cargar catálogos una sola vez para búsqueda rápida por nombre
        const [kupoWarehouses, kupoCostCenters] = await Promise.all([
            this.getWarehouses(),
            this.getCostCenters()
        ]);

        const findWarehouseId = (name: string): string => {
            if (!name) return '';
            const found = kupoWarehouses.find(w => w.name.trim().toLowerCase() === name.toLowerCase().trim());
            return found ? found.id : '';
        };

        const findCostCenterId = (name: string): string => {
            if (!name) return '';
            const found = kupoCostCenters.find(cc => cc.name.trim().toLowerCase() === name.toLowerCase().trim());
            return found ? found.id : '';
        };

        // Batch processing - 10 facturas concurrentes a la vez
        const chunkSize = 10;
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < invoices.length; i += chunkSize) {
            const chunk = invoices.slice(i, i + chunkSize);
            const chunkPromises = chunk.map(async (inv) => {
                let result: { invoiceId: any; success: boolean; error: string; } = { invoiceId: inv.originalInvoiceId, success: false, error: '' };
                try {
                    // Obtener cliente (Lo busca o lo crea)
                    const client = await this.findOrCreateClient({
                        name: String(inv.clientName || 'Cliente Mostrador'),
                        identification: inv.clientIdentification ? String(inv.clientIdentification) : '',
                        email: inv.clientEmail,
                        phone: inv.clientPhone,
                        address: inv.clientAddress,
                        city: inv.clientCity,
                        department: inv.clientDepartment
                    });

                    // Tienda original (Mandatorio para resolución de facturación)
                    let originalStoreKey = inv.originalStore?.toLowerCase().trim();
                    if (!originalStoreKey) {
                        const warehouseLower = inv.warehouseName?.toLowerCase();
                        if (warehouseLower?.includes('pasto')) originalStoreKey = 'pasto';
                        else if (warehouseLower?.includes('medellin')) originalStoreKey = 'medellin';
                        else if (warehouseLower?.includes('pereira')) originalStoreKey = 'pereira';
                        else if (warehouseLower?.includes('armenia')) originalStoreKey = 'armenia';
                        else originalStoreKey = 'pasto'; // default
                    }

                    const storeMapping = this.getStoreMapping(originalStoreKey);

                    // Prioridad 1: Buscar IDs por los NOMBRES que vienen en el Excel
                    // Prioridad 2: Fallback al mapeo por tienda si no se encuentra por nombre
                    const finalWarehouseId = findWarehouseId(inv.warehouseName) || storeMapping?.warehouseId || '';
                    const finalCostCenterId = findCostCenterId(inv.costCenterName) || storeMapping?.costCenterId || '';

                    // Facturar
                    const response = await this.createKupocellInvoice({
                        clientId: client.id,
                        items: inv.items,
                        warehouseId: finalWarehouseId,
                        costCenterId: finalCostCenterId,
                        applyIva: false, 
                        date: inv.date || new Date().toISOString().split('T')[0],
                        originalInvoiceId: inv.originalInvoiceId,
                        originalStore: originalStoreKey,
                        payments: inv.payments,
                        anotation: inv.anotation,
                        observations: inv.observations,
                        seller: inv.observations?.replace('Vendedor: ', '') || undefined,
                    });

                    if (response.success) {
                        result.success = true;
                        successCount++;
                    } else {
                        result.error = response.error || 'Error desconocido';
                        failCount++;
                    }
                } catch (error) {
                    this.logger.error(`Error procesando factura masiva ${inv.originalInvoiceId}: ${error.message}`);
                    result.error = error.message;
                    failCount++;

                    // Guardar log de error en la BD para que sea visible en el UI
                    const logIdentifier = inv.originalInvoiceId.includes('-') ? inv.originalInvoiceId : `${inv.originalStore || 'desconocida'}-${inv.originalInvoiceId}`;
                    await this.syncLogRepo.save({
                        originalInvoiceId: logIdentifier,
                        status: SyncStatus.FAILED,
                        errorMessage: error.message,
                    });
                }
                results.push(result);
            });

            await Promise.all(chunkPromises);

            // Un pequeño respiro de 300ms entre bloques
            if (i + chunkSize < invoices.length) {
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        this.logger.log(`✅ Facturación Masiva Completada: ${successCount} éxitos, ${failCount} errores`);
        return {
            success: true,
            total: invoices.length,
            successCount,
            failCount,
            results
        };
    }

    // ─── Sync Logs Query ──────────────────────────────────────────

    async getSyncLogs() {
        return this.syncLogRepo.find({
            order: { createdAt: 'DESC' },
            take: 300 // Return the last 300 logs
        });
    }

    // ─── Metadata ─────────────────────────────────────────────────

    async testConnection() {
        try {
            const response = await this.alegraKupoApi.get('/company');
            return response.data;
        } catch (error) {
            this.logger.error('Error connecting to Alegra Kupocell API', error.message);
            throw error;
        }
    }

    async getKupoProducts(forceSync = false) {
        try {
            if (!forceSync) {
                const cached = await this.catalogCacheRepo.findOne({ where: { type: 'products' } });
                if (cached && cached.data) {
                    return cached.data;
                }
            }

            const allProducts: any[] = [];
            let start = 0;
            const limit = 30;

            while (true) {
                const response = await this.alegraKupoApi.get(`/items?limit=${limit}&start=${start}`);
                const batch = response.data;
                if (!batch || batch.length === 0) break;
                allProducts.push(...batch);
                if (batch.length < limit) break;
                start += limit;
            }

            // Guardar en caché
            await this.catalogCacheRepo.upsert(
                { type: 'products', data: allProducts },
                ['type']
            );

            return allProducts;
        } catch (error) {
            this.logger.error('Error fetching Kupocell Products', error.message);
            throw error;
        }
    }

    async getKupoBanks(forceSync = false) {
        try {
            if (!forceSync) {
                const cached = await this.catalogCacheRepo.findOne({ where: { type: 'banks' } });
                if (cached && cached.data) {
                    return cached.data;
                }
            }

            const response = await this.alegraKupoApi.get('/bank-accounts');
            const banks = response.data;

            // Guardar en caché
            await this.catalogCacheRepo.upsert(
                { type: 'banks', data: banks },
                ['type']
            );

            return banks;
        } catch (error) {
            this.logger.error('Error fetching Kupocell Bank Accounts', error.message);
            throw error;
        }
    }

    async getWarehouses() {
        try {
            const response = await this.alegraKupoApi.get('/warehouses');
            return response.data;
        } catch (error) {
            this.logger.error('Error fetching Kupocell Warehouses', error.message);
            throw error;
        }
    }

    async getCostCenters() {
        try {
            const response = await this.alegraKupoApi.get('/cost-centers');
            return response.data;
        } catch (error) {
            this.logger.error('Error fetching cost centers', error.message);
            throw error;
        }
    }

    async getTaxes() {
        try {
            const response = await this.alegraKupoApi.get('/taxes');
            return response.data;
        } catch (error) {
            this.logger.error('Error fetching Kupocell Taxes', error.message);
            throw error;
        }
    }

    // ─── Product Mappings CRUD ────────────────────────────────────

    async getProductMappings() {
        return this.productMappingRepo.find();
    }

    async saveProductMappings(mappings: Partial<ProductMapping>[]) {
        // En una implementación real, podríamos querer un UPSERT o borrar y recrear.
        // Dado que la UI maneja toda la tabla junta, borremos todo y recreemos para simplificar.
        await this.productMappingRepo.clear();

        const entities = mappings.map(m => this.productMappingRepo.create(m));
        return this.productMappingRepo.save(entities);
    }

    // ─── Bank Mappings CRUD ───────────────────────────────────────

    async getBankMappings() {
        return this.bankMappingRepo.find();
    }

    async saveBankMappings(mappings: Partial<BankMapping>[]) {
        await this.bankMappingRepo.clear();
        const entities = mappings.map(m => this.bankMappingRepo.create(m));
        return this.bankMappingRepo.save(entities);
    }

    async getKupocellBanks(forceSync = false) {
        return this.getKupoBanks(forceSync);
    }

    // ─── Payment Synchronization Logic ────────────────────────────

    /**
     * Procesa los pagos de una factura original y los registra en Kupocell.
     */
    async processInvoicePayments(payments: { bankName: string, amount: number }[], kupoInvoiceId: string, date: string, originalStore: string) {
        this.logger.log(`💰 Procesando ${payments.length} pagos para factura Kupocell ${kupoInvoiceId} (Origen: ${originalStore})...`);

        const kupoBanks = await this.getKupoBanks();
        const mappings = await this.getBankMappings();

        // Determinar columna según tienda
        let storeColumnName = '';
        switch (originalStore.toLowerCase()) {
            case 'pasto': storeColumnName = 'namePasto'; break;
            case 'armenia': storeColumnName = 'nameArmenia'; break;
            case 'pereira': storeColumnName = 'namePereira'; break;
            case 'medellin': storeColumnName = 'nameMedellin'; break;
            default: storeColumnName = ''; break;
        }

        for (const payment of payments) {
            try {
                let targetBankId: string | null = null;

                // 1. Buscar en mapeos manuales si tenemos columna de tienda
                if (storeColumnName) {
                    const mapping = mappings.find(m => m[storeColumnName]?.trim().toLowerCase() === payment.bankName.trim().toLowerCase());
                    if (mapping) {
                        targetBankId = mapping.kupoBankId;
                    }
                }

                if (!targetBankId) {
                    // 2. Fallback: Búsqueda por similitud/contiene (según sugerido por usuario)
                    const lowerSource = payment.bankName.toLowerCase();
                    const fuzzyMatch = kupoBanks.find(kb =>
                        kb.name.toLowerCase().includes(lowerSource) ||
                        lowerSource.includes(kb.name.toLowerCase())
                    );

                    if (fuzzyMatch) {
                        targetBankId = fuzzyMatch.id;
                        this.logger.log(`🔍 Match difuso para banco "${payment.bankName}" -> "${fuzzyMatch.name}"`);
                    }
                }

                if (!targetBankId) {
                    this.logger.warn(`⚠️ No se encontró banco destino para "${payment.bankName}". El pago de ${payment.amount} NO se registrará.`);
                    continue;
                }

                // 3. Registrar el pago en Alegra Kupocell
                await this.createKupocellPayment({
                    invoiceId: kupoInvoiceId,
                    bankId: targetBankId,
                    amount: payment.amount,
                    date: date
                });

            } catch (err) {
                this.logger.error(`❌ Error registrando pago de "${payment.bankName}": ${err.message}`);
            }
        }
    }

    async createKupocellPayment(params: { invoiceId: string, bankId: string, amount: number, date: string }) {
        const payload = {
            date: params.date,
            bankAccount: params.bankId, // Alegra espera el string ID directo aquí para pagos
            invoices: [
                {
                    id: params.invoiceId,
                    amount: params.amount
                }
            ],
            type: 'in' // 'in' para recibos de caja (inbound)
        };

        const response = await this.alegraKupoApi.post('/payments', payload);
        this.logger.log(`✅ Pago de ${params.amount} registrado con éxito (ID Pago: ${response.data.id})`);
        return response.data;
    }

    async createInvoice(invoicePayload: any, originalIdentifier: string) {
        try {
            const response = await this.alegraKupoApi.post('/invoices', invoicePayload);
            const createdData = response.data;
            await this.syncLogRepo.save({
                originalInvoiceId: originalIdentifier,
                kupoInvoiceId: createdData.id,
                status: SyncStatus.SUCCESS,
            });
            return createdData;
        } catch (error) {
            const errorMsg = error.response?.data?.message || error.message;
            this.logger.error(`Error creating invoice in Kupocell: ${errorMsg}`);
            await this.syncLogRepo.save({
                originalInvoiceId: originalIdentifier,
                status: SyncStatus.FAILED,
                errorMessage: errorMsg
            });
            throw error;
        }
    }
}
