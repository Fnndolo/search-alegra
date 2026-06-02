import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import { InvoiceSyncLog, SyncStatus } from './entities/invoice-sync-log.entity';
import { ProductMapping } from '../entities/product-mapping.entity';
import { BankMapping } from '../entities/bank-mapping.entity';
import { KupoCatalogCache } from './entities/kupo-catalog-cache.entity';
import { BillingImportJob, ImportJobStatus } from './entities/billing-import-job.entity';

// Mapeo de tiendas origen → bodega y centro de costo en Kupocell
const STORE_MAPPING: Record<string, { warehouseId: string, warehouseName: string, costCenterId: string, costCenterName: string }> = {
    'pasto': { warehouseId: '1', warehouseName: 'PASTO', costCenterId: '1', costCenterName: 'PRINCIPAL PASTO' },
    'medellin': { warehouseId: '019c66ef-e6a5-70e1-90c8-9bc2c422138d', warehouseName: 'MEDELLIN', costCenterId: '2', costCenterName: 'SEDE MEDELLIN' },
    'pereira': { warehouseId: '019c66f0-70fb-7698-8a0a-a86826df31dd', warehouseName: 'PEREIRA', costCenterId: '3', costCenterName: 'SEDE PEREIRA' },
    'armenia': { warehouseId: '019c66f0-a218-719b-8af0-36b2599476d9', warehouseName: 'ARMENIA', costCenterId: '4', costCenterName: 'SEDE ARMENIA' },
    // TODO BOGOTÁ: reemplazar estos 3 valores por los IDs reales de Alegra cuando se cree
    // la bodega, el centro de costo y la numeración de Bogotá (ver también numberingId más abajo).
    'bogota': { warehouseId: 'PENDIENTE_BOGOTA_WAREHOUSE_ID', warehouseName: 'BOGOTA', costCenterId: 'PENDIENTE_BOGOTA_COSTCENTER_ID', costCenterName: 'SEDE BOGOTA' },
};

@Injectable()
export class ElectronicBillingService implements OnApplicationBootstrap {
    private readonly logger = new Logger(ElectronicBillingService.name);
    private readonly alegraKupoApi: AxiosInstance;

    // Rate limiter global (token bucket) para respetar el límite de Alegra (~2.5 req/s) SIN
    // tiempos muertos. Reemplaza el sleep fijo de 500ms. Lo comparten todos los workers.
    private readonly RATE_PER_SEC = 2;
    private readonly BUCKET_CAP = 4;
    private bucketTokens = 4;
    private bucketLastRefill = Date.now();

    constructor(
        @InjectRepository(InvoiceSyncLog)
        private syncLogRepo: Repository<InvoiceSyncLog>,
        @InjectRepository(ProductMapping)
        private productMappingRepo: Repository<ProductMapping>,
        @InjectRepository(BankMapping)
        private bankMappingRepo: Repository<BankMapping>,
        @InjectRepository(KupoCatalogCache)
        private catalogCacheRepo: Repository<KupoCatalogCache>,
        @InjectRepository(BillingImportJob)
        private jobRepo: Repository<BillingImportJob>,
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

    // ─── Rate limiting & Background Jobs ──────────────────────────

    /** Token bucket global: espera hasta tener un token (mantiene el ritmo agregado ≈ RATE_PER_SEC req/s). */
    private async acquireToken(): Promise<void> {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const now = Date.now();
            const elapsedSec = (now - this.bucketLastRefill) / 1000;
            this.bucketTokens = Math.min(this.BUCKET_CAP, this.bucketTokens + elapsedSec * this.RATE_PER_SEC);
            this.bucketLastRefill = now;
            if (this.bucketTokens >= 1) {
                this.bucketTokens -= 1;
                return;
            }
            const waitMs = Math.ceil(((1 - this.bucketTokens) / this.RATE_PER_SEC) * 1000);
            await new Promise(r => setTimeout(r, waitMs));
        }
    }

    /** POST /invoices con rate limit; reintenta SOLO ante 429 (el 429 garantiza que NO se creó nada).
     *  No reintenta ante otros errores para no arriesgar duplicados sin Idempotency-Key nativo. */
    private async postInvoiceWithRateLimit(payload: any, maxRetries = 4): Promise<any> {
        for (let attempt = 1; ; attempt++) {
            await this.acquireToken();
            try {
                const response = await this.alegraKupoApi.post('/invoices', payload);
                return response.data;
            } catch (err) {
                const status = err.response?.status;
                if (status === 429 && attempt < maxRetries) {
                    const waitMs = attempt * 1500;
                    this.logger.warn(`⏳ 429 al crear factura. Reintento ${attempt}/${maxRetries} en ${waitMs}ms...`);
                    await new Promise(r => setTimeout(r, waitMs));
                    continue;
                }
                throw err;
            }
        }
    }

    /** Al arrancar: asegura el lock a nivel DB (máx. 1 job PROCESSING) y reanuda jobs colgados.
     *  La idempotencia (invoice_sync_log) hace seguro reprocesar: las ya creadas se saltan. */
    async onApplicationBootstrap() {
        // Lock a nivel DB con índice único PARCIAL: a lo sumo UN job PROCESSING a la vez.
        // Se crea aquí (IF NOT EXISTS) y no vía synchronize, para evitar fragilidad de arranque.
        try {
            await this.jobRepo.query(
                `CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_import_jobs_one_processing ON billing_import_jobs (status) WHERE status = 'PROCESSING'`
            );
        } catch (err) {
            this.logger.warn(`No se pudo crear el índice de lock de import jobs: ${err.message}`);
        }

        try {
            const pending = await this.jobRepo.find({ where: { status: ImportJobStatus.PROCESSING } });
            if (pending.length === 0) return;
            this.logger.warn(`♻️ Reanudando ${pending.length} import job(s) que quedaron PROCESSING tras un restart...`);
            for (const job of pending) {
                const jobId = job.id;
                // Reiniciar contadores antes de reprocesar (la idempotencia salta las ya creadas,
                // pero el progreso debe contar de 0..N de nuevo para no pasarse de total).
                await this.jobRepo.update(jobId, { processed: 0, successCount: 0, failCount: 0 });
                this.runImportJob(jobId, job.invoices || []).catch(async err => {
                    this.logger.error(`Error reanudando job ${jobId}: ${err.message}`);
                    await this.jobRepo.update(jobId, { status: ImportJobStatus.FAILED, errorMessage: String(err?.message || err) }).catch(() => { });
                });
            }
        } catch (err) {
            this.logger.error(`Error en reanudación de jobs: ${err.message}`);
        }
    }

    /** Crea un job (PROCESSING) y lanza el procesamiento en BACKGROUND. Devuelve al instante.
     *  El índice único parcial garantiza que NO existan dos jobs PROCESSING a la vez (anti-duplicación). */
    async createImportJob(invoices: any[]): Promise<BillingImportJob> {
        let job: BillingImportJob;
        try {
            job = await this.jobRepo.save(this.jobRepo.create({
                status: ImportJobStatus.PROCESSING,
                total: invoices.length,
                processed: 0,
                successCount: 0,
                failCount: 0,
                invoices,
            }));
        } catch (err: any) {
            // Violación del índice único parcial: dos subidas casi simultáneas. NO duplicar:
            // reutilizar el job en curso.
            if (err?.code === '23505' || err?.driverError?.code === '23505') {
                const running = await this.getRunningImportJob();
                if (running) {
                    this.logger.warn(`Subida simultánea detectada; reutilizando job en curso ${running.id}`);
                    return running;
                }
            }
            throw err;
        }

        const jobId = job.id;
        this.runImportJob(jobId, invoices).catch(async err => {
            this.logger.error(`Error en import job ${jobId}: ${err.message}`);
            // No dejar el job (y por tanto el lock) atascado en PROCESSING.
            await this.jobRepo.update(jobId, { status: ImportJobStatus.FAILED, errorMessage: String(err?.message || err) }).catch(() => { });
        });
        return job;
    }

    /** Lock global por cuenta Kupocell: ¿hay un import en curso? (evita re-disparos/duplicación). */
    async getRunningImportJob(): Promise<BillingImportJob | null> {
        return this.jobRepo.findOne({ where: { status: ImportJobStatus.PROCESSING }, order: { createdAt: 'DESC' } });
    }

    async getImportJob(id: string): Promise<BillingImportJob | null> {
        return this.jobRepo.findOne({ where: { id } });
    }

    /** Ejecuta el procesamiento del job y persiste progreso/resultado. */
    private async runImportJob(jobId: string, invoices: any[]) {
        try {
            const report = await this.processMassExcelInvoices(invoices, jobId);
            await this.jobRepo.update(jobId, {
                status: ImportJobStatus.COMPLETED,
                results: report.results,
                successCount: report.successCount,
                failCount: report.failCount,
                processed: report.total,
            });
        } catch (err) {
            this.logger.error(`Import job ${jobId} falló: ${err.message}`);
            await this.jobRepo.update(jobId, { status: ImportJobStatus.FAILED, errorMessage: err.message });
        }
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
    }, preloadedMappings?: ProductMapping[]): Promise<{ success: boolean; invoiceId?: string; invoiceNumber?: string; error?: string; matchResults?: { name: string, matched: string | null }[]; skipped?: boolean }> {
        try {
            // 0. IDEMPOTENCIA: si esta factura origen ya se creó con éxito, NO crear de nuevo (evita duplicados).
            const idLog = `${params.originalStore}-${params.originalInvoiceId}`;
            const already = await this.syncLogRepo.findOne({ where: { originalInvoiceId: idLog, status: SyncStatus.SUCCESS } });
            if (already) {
                this.logger.log(`↩️ Factura ${idLog} ya existe en Kupocell (id ${already.kupoInvoiceId}); se omite para no duplicar.`);
                return { success: true, invoiceId: already.kupoInvoiceId, invoiceNumber: already.kupoInvoiceId, skipped: true };
            }

            // 1. Mapeo de productos (precargado en masivo; carga puntual en facturación individual)
            const mappings = preloadedMappings || await this.productMappingRepo.find();

            // Determinar la columna a buscar según la tienda original
            let storeColumnName = '';
            switch (params.originalStore.toLowerCase()) {
                case 'pasto': storeColumnName = 'namePasto'; break;
                case 'armenia': storeColumnName = 'nameArmenia'; break;
                case 'pereira': storeColumnName = 'namePereira'; break;
                case 'medellin': storeColumnName = 'nameMedellin'; break;
                case 'bogota': storeColumnName = 'nameBogota'; break;
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
                // TODO BOGOTÁ: poner aquí el ID de numeración de Bogotá cuando se cree en Alegra.
                // Mientras quede vacío, no se envía numberTemplate y Alegra usa la numeración por defecto.
                case 'bogota': numberingId = ''; break;
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

            const created = await this.postInvoiceWithRateLimit(invoicePayload);

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

    async processMassExcelInvoices(invoices: any[], jobId?: string) {
        const results: { invoiceId: any; success: boolean; error: string; paymentErrors?: string[]; skipped?: boolean }[] = [];
        this.logger.log(`🚀 Facturación masiva de ${invoices.length} facturas (paralelo por tienda + rate-limit global, idempotente)...`);

        // Precargar catálogos Y mapeos de productos UNA SOLA VEZ (antes los product mappings se cargaban POR factura)
        const [kupoWarehouses, kupoCostCenters, kupoBanks, bankMappings, productMappings] = await Promise.all([
            this.getWarehouses(),
            this.getCostCenters(),
            this.getKupoBanks(),
            this.getBankMappings(),
            this.productMappingRepo.find(),
        ]);

        this.logger.log(`📦 Catálogos: ${kupoWarehouses.length} bodegas, ${kupoCostCenters.length} centros, ${kupoBanks.length} bancos, ${bankMappings.length} mapeos banco, ${productMappings.length} mapeos producto`);

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

        // Cache de clientes por lote: evita GET /contacts repetido para el mismo cliente.
        const clientCache = new Map<string, { id: string; name: string; isNew: boolean }>();

        let successCount = 0;
        let failCount = 0;

        const resolveStoreKey = (inv: any): string => {
            let key = inv.originalStore?.toLowerCase().trim();
            if (!key) {
                const wl = inv.warehouseName?.toLowerCase();
                if (wl?.includes('pasto')) key = 'pasto';
                else if (wl?.includes('medellin')) key = 'medellin';
                else if (wl?.includes('pereira')) key = 'pereira';
                else if (wl?.includes('armenia')) key = 'armenia';
                else if (wl?.includes('bogota')) key = 'bogota';
                else key = 'pasto';
            }
            return key;
        };

        // Procesa UNA factura: cliente (cacheado) → crear factura (idempotente) → pagos.
        const processOne = async (inv: any) => {
            const result: { invoiceId: any; success: boolean; error: string; paymentErrors?: string[]; skipped?: boolean } = {
                invoiceId: inv.originalInvoiceId, success: false, error: ''
            };
            try {
                const originalStoreKey = resolveStoreKey(inv);

                // Cliente con cache por identificación (los "Cliente Mostrador" sin id NO se cachean)
                const idKey = inv.clientIdentification ? String(inv.clientIdentification).trim() : '';
                let client = idKey ? clientCache.get(idKey) : undefined;
                if (!client) {
                    client = await this.findOrCreateClient({
                        name: String(inv.clientName || 'Cliente Mostrador'),
                        identification: idKey,
                        email: inv.clientEmail,
                        phone: inv.clientPhone,
                        address: inv.clientAddress,
                        city: inv.clientCity,
                        department: inv.clientDepartment
                    });
                    if (idKey) clientCache.set(idKey, client);
                }

                const storeMapping = this.getStoreMapping(originalStoreKey);
                const finalWarehouseId = findWarehouseId(inv.warehouseName) || storeMapping?.warehouseId || '';
                const finalCostCenterId = findCostCenterId(inv.costCenterName) || storeMapping?.costCenterId || '';

                // Crear factura (sin pagos aquí; los procesamos aparte). Mapeos precargados.
                const response = await this.createKupocellInvoice({
                    clientId: client.id,
                    items: inv.items,
                    warehouseId: finalWarehouseId,
                    costCenterId: finalCostCenterId,
                    applyIva: false,
                    date: inv.date || new Date().toISOString().split('T')[0],
                    originalInvoiceId: inv.originalInvoiceId,
                    originalStore: originalStoreKey,
                    payments: undefined,
                    anotation: inv.anotation,
                    observations: inv.observations,
                    seller: inv.observations?.replace('Vendedor: ', '') || undefined,
                }, productMappings);

                if (response.success) {
                    result.success = true;
                    successCount++;
                    if (response.skipped) {
                        // Ya existía: no reprocesar pagos (ya se hicieron en su creación original).
                        result.skipped = true;
                    } else if (inv.payments && inv.payments.length > 0 && response.invoiceId) {
                        const paymentErrors = await this.processInvoicePaymentsWithPreloadedData(
                            inv.payments, response.invoiceId,
                            inv.date || new Date().toISOString().split('T')[0],
                            originalStoreKey, kupoBanks, bankMappings
                        );
                        if (paymentErrors.length > 0) result.paymentErrors = paymentErrors;
                    }
                } else {
                    result.error = response.error || 'Error desconocido';
                    failCount++;
                }
            } catch (error) {
                this.logger.error(`Error procesando factura masiva ${inv.originalInvoiceId}: ${error.message}`);
                result.error = error.message;
                failCount++;
                const logId = String(inv.originalInvoiceId).includes('-') ? inv.originalInvoiceId : `${inv.originalStore || 'desconocida'}-${inv.originalInvoiceId}`;
                await this.syncLogRepo.save({ originalInvoiceId: logId, status: SyncStatus.FAILED, errorMessage: error.message });
            }
            results.push(result);
            // Progreso ATÓMICO en DB para el polling del front (processed + success/fail en vivo)
            if (jobId) {
                await this.jobRepo.increment({ id: jobId }, 'processed', 1);
                await this.jobRepo.increment({ id: jobId }, result.success ? 'successCount' : 'failCount', 1);
            }
        };

        // Particionar por tienda (numberTemplate): tiendas DISTINTAS en paralelo; misma tienda
        // en SERIE (evita la colisión de consecutivo que motivó el sleep). El token bucket global
        // mantiene el ritmo agregado bajo el límite de Alegra.
        const partitions = new Map<string, any[]>();
        for (const inv of invoices) {
            const key = resolveStoreKey(inv);
            if (!partitions.has(key)) partitions.set(key, []);
            partitions.get(key)!.push(inv);
        }
        this.logger.log(`🧩 ${partitions.size} partición(es) por tienda: ${[...partitions.entries()].map(([k, v]) => `${k}:${v.length}`).join(', ')}`);

        await Promise.all([...partitions.values()].map(async (list) => {
            for (const inv of list) {
                await processOne(inv);
            }
        }));

        // Los contadores en DB ya se actualizaron atómicamente por factura (increment).
        // runImportJob hará el SET final autoritativo de status/results/contadores.
        this.logger.log(`✅ Facturación Masiva Completada: ${successCount} éxitos, ${failCount} errores`);
        return { success: true, total: invoices.length, successCount, failCount, results };
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
     * Versión que recibe catálogos pre-cargados para evitar llamadas redundantes.
     */
    async processInvoicePaymentsWithPreloadedData(
        payments: { bankName: string, amount: number }[],
        kupoInvoiceId: string,
        date: string,
        originalStore: string,
        kupoBanks: any[],
        bankMappings: any[]
    ): Promise<string[]> {
        const paymentErrors: string[] = [];
        this.logger.log(`💰 Procesando ${payments.length} pago(s) para factura Kupocell ${kupoInvoiceId} (Origen: ${originalStore})...`);

        // Determinar columna según tienda
        let storeColumnName = '';
        switch (originalStore.toLowerCase()) {
            case 'pasto': storeColumnName = 'namePasto'; break;
            case 'armenia': storeColumnName = 'nameArmenia'; break;
            case 'pereira': storeColumnName = 'namePereira'; break;
            case 'medellin': storeColumnName = 'nameMedellin'; break;
            case 'bogota': storeColumnName = 'nameBogota'; break;
            default: storeColumnName = ''; break;
        }

        // Obtener el ID del primer banco disponible como fallback final
        const fallbackBankId = kupoBanks.length > 0 ? kupoBanks[0].id : null;
        const fallbackBankName = kupoBanks.length > 0 ? kupoBanks[0].name : 'N/A';

        for (const payment of payments) {
            try {
                if (!payment.amount || payment.amount <= 0) {
                    this.logger.warn(`⚠️ Saltando pago con monto inválido: ${payment.amount} para banco "${payment.bankName}"`);
                    continue;
                }

                let targetBankId: string | null = null;
                let matchMethod = '';

                // 1. Buscar en mapeos manuales si tenemos columna de tienda
                if (storeColumnName) {
                    const mapping = bankMappings.find(m => 
                        m[storeColumnName]?.trim().toLowerCase() === payment.bankName.trim().toLowerCase()
                    );
                    if (mapping) {
                        targetBankId = mapping.kupoBankId;
                        matchMethod = `mapeo manual (${storeColumnName}: "${payment.bankName}" → kupoBankId: ${mapping.kupoBankId}, kupoName: "${mapping.kupoBankName}")`;
                    }
                }

                // 2. Fallback: Búsqueda por similitud/contiene
                if (!targetBankId) {
                    const lowerSource = payment.bankName.toLowerCase().trim();
                    const fuzzyMatch = kupoBanks.find(kb =>
                        kb.name.toLowerCase().includes(lowerSource) ||
                        lowerSource.includes(kb.name.toLowerCase())
                    );

                    if (fuzzyMatch) {
                        targetBankId = fuzzyMatch.id;
                        matchMethod = `match difuso ("${payment.bankName}" ≈ "${fuzzyMatch.name}", ID: ${fuzzyMatch.id})`;
                    }
                }

                // 3. Fallback final: Primer banco disponible en Kupocell
                if (!targetBankId && fallbackBankId) {
                    targetBankId = fallbackBankId;
                    matchMethod = `FALLBACK a primer banco disponible ("${fallbackBankName}", ID: ${fallbackBankId})`;
                    this.logger.warn(`⚠️ Banco "${payment.bankName}" no encontrado en mapeos ni por similitud. Usando fallback: "${fallbackBankName}"`);
                }

                if (!targetBankId) {
                    const errMsg = `No hay bancos disponibles en Kupocell para registrar pago de "${payment.bankName}" ($${payment.amount})`;
                    this.logger.error(`❌ ${errMsg}`);
                    paymentErrors.push(errMsg);
                    continue;
                }

                this.logger.log(`🏦 Banco resuelto para "${payment.bankName}" ($${payment.amount}) → ${matchMethod}`);

                // Registrar el pago con reintentos
                await this.createKupocellPaymentWithRetry({
                    invoiceId: kupoInvoiceId,
                    bankId: targetBankId,
                    amount: payment.amount,
                    date: date
                });

            } catch (err) {
                const errDetail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
                const errMsg = `Error registrando pago de "${payment.bankName}" ($${payment.amount}): ${errDetail}`;
                this.logger.error(`❌ ${errMsg}`);
                paymentErrors.push(errMsg);
            }
        }

        if (paymentErrors.length > 0) {
            this.logger.warn(`⚠️ ${paymentErrors.length} error(es) de pago para factura ${kupoInvoiceId}`);
        } else {
            this.logger.log(`✅ Todos los pagos registrados exitosamente para factura ${kupoInvoiceId}`);
        }

        return paymentErrors;
    }

    /**
     * Procesa los pagos de una factura (versión legacy que carga datos cada vez).
     * Usada por la facturación individual (no masiva).
     */
    async processInvoicePayments(payments: { bankName: string, amount: number }[], kupoInvoiceId: string, date: string, originalStore: string) {
        const kupoBanks = await this.getKupoBanks();
        const mappings = await this.getBankMappings();
        return this.processInvoicePaymentsWithPreloadedData(payments, kupoInvoiceId, date, originalStore, kupoBanks, mappings);
    }

    /**
     * Crea un pago en Kupocell con hasta 3 reintentos automáticos.
     */
    async createKupocellPaymentWithRetry(params: { invoiceId: string, bankId: string, amount: number, date: string }, maxRetries = 3) {
        const payload = {
            date: params.date,
            bankAccount: params.bankId,
            invoices: [
                {
                    id: params.invoiceId,
                    amount: params.amount
                }
            ],
            type: 'in'
        };

        let lastError: any = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.logger.log(`💳 Intento ${attempt}/${maxRetries}: Registrando pago de $${params.amount} → Factura ${params.invoiceId}, Banco ${params.bankId}`);
                this.logger.debug(`    Payload: ${JSON.stringify(payload)}`);

                await this.acquireToken();
                const response = await this.alegraKupoApi.post('/payments', payload);
                this.logger.log(`✅ Pago de $${params.amount} registrado con éxito (ID Pago: ${response.data.id}) en intento ${attempt}`);
                return response.data;
            } catch (err) {
                lastError = err;
                const errDetail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
                this.logger.warn(`⚠️ Intento ${attempt}/${maxRetries} falló para pago de $${params.amount}: ${errDetail}`);

                if (attempt < maxRetries) {
                    // Esperar más tiempo entre cada reintento (exponential backoff)
                    const waitMs = attempt * 1000;
                    this.logger.log(`   ⏳ Esperando ${waitMs}ms antes de reintentar...`);
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                }
            }
        }

        // Todos los reintentos fallaron
        const finalError = lastError?.response?.data ? JSON.stringify(lastError.response.data) : lastError?.message;
        throw new Error(`Pago falló después de ${maxRetries} intentos: ${finalError}`);
    }

    async createKupocellPayment(params: { invoiceId: string, bankId: string, amount: number, date: string }) {
        return this.createKupocellPaymentWithRetry(params);
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
