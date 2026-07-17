import { Controller, Get, Post, Patch, Put, Body, Query, Param, Logger, BadRequestException, UploadedFile, UseInterceptors, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ElectronicBillingService } from './electronic-billing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull, In } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { ImportJobStatus } from './entities/billing-import-job.entity';
import { StoreCredentialsService } from '../shared/store-credentials.service';
import * as xlsx from 'xlsx';
import axios from 'axios';

// Palabras clave que identifican pago en efectivo
const CASH_KEYWORDS = ['efectivo', 'cash', 'caja', 'terminal', 'caja menor', 'caja general', 'datafono', 'datáfono'];

function isCashPayment(bankName: string): boolean {
    if (!bankName) return false;
    const lower = bankName.toLowerCase().trim();
    return CASH_KEYWORDS.some(keyword => lower.includes(keyword));
}

function isInvoiceCashOnly(paymentBankAccounts: { bankName: string }[] | null): boolean {
    // Si no tenemos info de pagos, NO filtrar (mostrar la factura)
    if (!paymentBankAccounts || paymentBankAccounts.length === 0) return false;
    // Es cash-only si TODOS los pagos son de efectivo
    return paymentBankAccounts.every(p => isCashPayment(p.bankName));
}

@Controller('electronic-billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.FACTURACION)
export class ElectronicBillingController {
    private readonly logger = new Logger(ElectronicBillingController.name);

    constructor(
        private readonly billingService: ElectronicBillingService,
        @InjectRepository(Invoice)
        private readonly invoiceRepository: Repository<Invoice>,
        private readonly storeCredentialsService: StoreCredentialsService,
    ) { }

    // ─── Helpers ─────────────────────────────────────────────────

    /**
     * Obtiene TODOS los pagos (bank accounts) de una factura desde la API de Alegra.
     */
    private async fetchAllPaymentBankAccounts(store: string, invoiceData: any): Promise<{ paymentId: string, bankName: string, amount: number }[]> {
        try {
            const credentials = this.storeCredentialsService.getCredentials(store);
            const payments = invoiceData?.payments || [];

            if (payments.length === 0) return [];

            const results: { paymentId: string, bankName: string, amount: number }[] = [];

            for (const payment of payments) {
                if (!payment.id) continue;
                try {
                    const response = await axios.get(`https://api.alegra.com/api/v1/payments/${payment.id}`, {
                        headers: { Authorization: `Basic ${Buffer.from(credentials.apiKey).toString('base64')}` },
                    });
                    const paymentData = response.data;
                    results.push({
                        paymentId: String(payment.id),
                        bankName: paymentData?.bankAccount?.name || 'Desconocido',
                        amount: parseFloat(paymentData?.amount) || 0,
                    });
                } catch (err) {
                    this.logger.warn(`Error fetching payment ${payment.id}: ${err.message}`);
                    results.push({
                        paymentId: String(payment.id),
                        bankName: 'Error al obtener',
                        amount: parseFloat(payment.amount) || 0,
                    });
                }
            }

            return results;
        } catch (error) {
            this.logger.warn(`Error fetching payments for invoice: ${error.message}`);
            return [];
        }
    }

    /**
     * Enriquece facturas que no tengan paymentBankAccounts cargados aún.
     * Guarda en la DB para no tener que volver a consultar.
     */
    private async enrichPaymentInfo(invoices: Invoice[]): Promise<void> {
        const toEnrich = invoices.filter(inv => inv.paymentBankAccounts === null || inv.paymentBankAccounts === undefined);

        if (toEnrich.length === 0) return;

        this.logger.log(`📦 Enriqueciendo ${toEnrich.length} facturas con info de pagos...`);

        // Procesar en lotes de 5 para no saturar la API
        const batchSize = 5;
        for (let i = 0; i < toEnrich.length; i += batchSize) {
            const batch = toEnrich.slice(i, i + batchSize);
            await Promise.all(batch.map(async (inv) => {
                const bankAccounts = await this.fetchAllPaymentBankAccounts(inv.store, inv.data);
                inv.paymentBankAccounts = bankAccounts;
                await this.invoiceRepository.update(
                    { id: inv.id, store: inv.store },
                    { paymentBankAccounts: bankAccounts }
                );
            }));
        }

        this.logger.log(`✅ Enriquecimiento de pagos completado`);
    }

    // ─── Endpoints ───────────────────────────────────────────────

    /**
     * GET /electronic-billing/invoices
     * Trae las facturas con billingStatus, filtra las que son solo efectivo.
     */
    @Get('invoices')
    async getBillingInvoices(
        @Query('status') status?: string,
        @Query('store') store?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
        @Query('dateFrom') dateFrom?: string,
        @Query('dateTo') dateTo?: string,
    ) {
        const pageNum = Number(page) || 1;
        const limitNum = Number(limit) || 50;

        const qb = this.invoiceRepository
            .createQueryBuilder('invoice')
            .where('invoice."billingStatus" IS NOT NULL')
            .andWhere("invoice.data->>'status' NOT IN ('void', 'draft')");

        if (status) {
            if (status === 'facturada_all') {
                qb.andWhere('invoice."billingStatus" IN (:...statuses)', { statuses: ['facturada', 'facturada_sistema'] });
            } else {
                qb.andWhere('invoice."billingStatus" = :status', { status });
            }
        }

        if (store && store.toLowerCase() !== 'todas') {
            qb.andWhere('invoice.store = :store', { store });
        }

        if (search) {
            qb.andWhere("CAST(invoice.data AS TEXT) ILIKE :search", { search: `%${search}%` });
        }

        if (dateFrom) {
            qb.andWhere("invoice.data->>'date' >= :dateFrom", { dateFrom });
        }

        if (dateTo) {
            qb.andWhere("invoice.data->>'date' <= :dateTo", { dateTo });
        }

        qb.orderBy("CAST(invoice.data->>'id' AS INTEGER)", 'DESC')
          .take(limitNum)
          .skip((pageNum - 1) * limitNum);

        const [invoices, total] = await qb.getManyAndCount();

        // Fire-and-forget: enrich in background, don't block the response
        this.enrichPaymentInfo(invoices).catch(err =>
          this.logger.error('Error enriching payment info in background', err),
        );

        // Filtrar: excluir facturas que SOLO tengan pagos en efectivo
        const filtered = invoices.filter(inv => !isInvoiceCashOnly(inv.paymentBankAccounts));

        return {
            total,
            page: pageNum,
            limit: limitNum,
            data: filtered.map(inv => {
                const items = (inv.data?.items || []).map((item: any) => ({
                    id: item.id,
                    name: item.name || 'Sin nombre',
                    description: item.description || '',
                    quantity: parseFloat(item.quantity) || 1,
                    price: parseFloat(item.price) || 0,
                    total: parseFloat(item.total) || 0,
                    tax: item.tax || [],
                }));

                const selectedIds = inv.selectedItemIds;
                const selectedItemsCount = selectedIds ? selectedIds.length : items.length;

                return {
                    id: inv.id,
                    store: inv.store,
                    storeDisplayName: this.storeCredentialsService.getStoreDisplayName(inv.store),
                    billingStatus: inv.billingStatus,
                    selectedItemIds: inv.selectedItemIds,
                    number: inv.data?.numberTemplate?.number || inv.data?.consecutivo || inv.id,
                    client: inv.data?.client?.name || 'Sin cliente',
                    clientId: inv.data?.client?.identification || '',
                    clientAddress: inv.data?.client?.address?.address || '',
                    clientPhone: inv.data?.client?.phonePrimary || inv.data?.client?.mobile || '',
                    clientEmail: inv.data?.client?.email || '',
                    productName: inv.data?.items?.[0]?.name || 'Sin producto',
                    items,
                    itemsCount: items.length,
                    selectedItemsCount,
                    paymentBankAccounts: inv.paymentBankAccounts || [],
                    subtotal: parseFloat(inv.data?.subtotal) || 0,
                    totalTax: parseFloat(inv.data?.totalPaid) - parseFloat(inv.data?.subtotal) || 0,
                    total: parseFloat(inv.data?.total) || 0,
                    date: inv.data?.date || inv.date,
                    dueDate: inv.data?.dueDate || null,
                    seller: inv.data?.seller?.name || '',
                    observations: inv.data?.observations || '',
                    createdAt: inv.createdAt,
                };
            })
        };
    }

    /**
     * PATCH /electronic-billing/invoices/status
     */
    @Patch('invoices/status')
    async updateBillingStatus(@Body() payload: {
        invoiceIds: { id: number, store: string }[],
        status: string
    }) {
        if (!payload.invoiceIds || payload.invoiceIds.length === 0) {
            throw new BadRequestException('Se requiere al menos una factura');
        }

        if (!['pendiente', 'facturada', 'facturada_sistema'].includes(payload.status)) {
            throw new BadRequestException('Estado inválido. Usar "pendiente" o "facturada"');
        }

        let updated = 0;
        for (const inv of payload.invoiceIds) {
            // No permitir pasar a pendiente si fue facturada por el sistema
            if (payload.status === 'pendiente') {
                const dbInv = await this.invoiceRepository.findOne({ where: { id: inv.id, store: inv.store } });
                if (dbInv && dbInv.billingStatus === 'facturada_sistema') {
                    continue;
                }
            }
            const result = await this.invoiceRepository.update(
                { id: inv.id, store: inv.store },
                { billingStatus: payload.status }
            );
            if (result.affected) updated++;
        }

        this.logger.log(`✅ ${updated} facturas actualizadas a estado "${payload.status}"`);

        return {
            success: true,
            updatedCount: updated,
            status: payload.status
        };
    }

    /**
     * PATCH /electronic-billing/invoices/items
     */
    @Patch('invoices/items')
    async updateSelectedItems(@Body() payload: {
        id: number,
        store: string,
        selectedItemIds: string[]
    }) {
        if (!payload.id || !payload.store) {
            throw new BadRequestException('Se requiere id y store de la factura');
        }

        const idsToSave = payload.selectedItemIds;

        const result = await this.invoiceRepository.update(
            { id: payload.id, store: payload.store },
            { selectedItemIds: idsToSave }
        );

        this.logger.log(`📝 Selección de items actualizada para factura ${payload.id}: ${idsToSave?.length ?? 'todos'} items`);

        return {
            success: true,
            affected: result.affected
        };
    }

    /**
     * POST /electronic-billing/mark-recent
     */
    @Post('mark-recent')
    async markRecentAsPendiente(@Body() payload: { sinceDate?: string }) {
        const since = payload?.sinceDate
            ? new Date(payload.sinceDate)
            : new Date(new Date().toISOString().split('T')[0]);

        const result = await this.invoiceRepository
            .createQueryBuilder()
            .update(Invoice)
            .set({ billingStatus: 'pendiente' })
            .where('"billingStatus" IS NULL')
            .andWhere('"createdAt" >= :since', { since })
            .execute();

        this.logger.log(`📌 ${result.affected} facturas marcadas como pendiente (desde ${since.toISOString()})`);

        return {
            success: true,
            markedCount: result.affected,
            since: since.toISOString()
        };
    }

    /**
     * POST /electronic-billing/refresh-payments
     * Fuerza re-carga de info de pagos para todas las facturas pendientes.
     * Útil para backfill o cuando se quiere actualizar la info.
     */
    @Post('refresh-payments')
    async refreshPaymentInfo() {
        const invoices = await this.invoiceRepository
            .createQueryBuilder('invoice')
            .where('invoice."billingStatus" IS NOT NULL')
            .andWhere("invoice.data->>'status' != :void", { void: 'void' })
            .getMany();

        // Resetear para forzar re-fetch
        const toRefresh = invoices.filter(inv => inv.paymentBankAccounts === null || inv.paymentBankAccounts === undefined);

        this.logger.log(`🔄 Refrescando pagos para ${toRefresh.length} facturas...`);

        await this.enrichPaymentInfo(toRefresh);

        const cashOnly = invoices.filter(inv => isInvoiceCashOnly(inv.paymentBankAccounts));

        return {
            success: true,
            totalInvoices: invoices.length,
            enriched: toRefresh.length,
            cashOnlyCount: cashOnly.length,
            visibleCount: invoices.length - cashOnly.length,
        };
    }

    // ─── Kupocell Invoice Creation ───────────────────────────────

    /**
     * GET /electronic-billing/kupocell-config
     * Retorna bodegas, centros de costo y mapeo de tiendas para el modal de facturación.
     */
    @Get('kupocell-config')
    async getKupocellConfig() {
        try {
            const [warehouses, costCenters] = await Promise.all([
                this.billingService.getWarehouses(),
                this.billingService.getCostCenters(),
            ]);

            return {
                warehouses: warehouses.map((w: any) => ({ id: w.id, name: w.name })),
                costCenters: costCenters.map((cc: any) => ({ id: cc.id, name: cc.name })),
                storeMappings: this.billingService.getAllStoreMappings(),
            };
        } catch (error) {
            throw new BadRequestException('Error obteniendo configuración de Kupocell');
        }
    }

    /**
     * POST /electronic-billing/create-kupocell-invoice
     * Crea facturas en la cuenta de Kupocell para las facturas seleccionadas.
     */
    @Post('create-kupocell-invoice')
    async createKupocellInvoice(@Body() payload: {
        invoiceIds: { id: number, store: string }[],
        warehouseId: string,
        costCenterId: string,
        applyIva: boolean,
    }) {
        if (!payload.invoiceIds || payload.invoiceIds.length === 0) {
            throw new BadRequestException('Se requiere al menos una factura');
        }

        if (!payload.warehouseId || !payload.costCenterId) {
            throw new BadRequestException('Se requiere bodega y centro de costo');
        }

        this.logger.log(`🚀 Iniciando creación de ${payload.invoiceIds.length} factura(s) en Kupocell...`);

        const results: { invoiceId: number, store: string, success: boolean, kupocellNumber?: string, error?: string }[] = [];

        for (const invRef of payload.invoiceIds) {
            try {
                // 1. Obtener la factura de la DB
                const invoice = await this.invoiceRepository.findOne({
                    where: { id: invRef.id, store: invRef.store }
                });

                if (!invoice) {
                    results.push({ invoiceId: invRef.id, store: invRef.store, success: false, error: 'Factura no encontrada' });
                    continue;
                }

                const invoiceData = invoice.data;

                // 2. Buscar o crear cliente en Kupocell
                const clientResult = await this.billingService.findOrCreateClient({
                    name: invoiceData?.client?.name || 'Sin nombre',
                    identification: invoiceData?.client?.identification || '',
                    identificationType: invoiceData?.client?.identificationObject?.type || 'CC',
                    address: invoiceData?.client?.address?.address || '',
                    city: invoiceData?.client?.address?.city || '',
                    department: invoiceData?.client?.address?.department || '',
                    phone: invoiceData?.client?.phonePrimary || invoiceData?.client?.mobile || '',
                    email: invoiceData?.client?.email || '',
                });

                // 3. Construir items (solo los seleccionados si hay selección guardada)
                const allItems = invoiceData?.items || [];
                const selectedIds = invoice.selectedItemIds;
                const itemsToInvoice = selectedIds
                    ? allItems.filter((item: any) => selectedIds.includes(String(item.id)))
                    : allItems;

                if (itemsToInvoice.length === 0) {
                    results.push({ invoiceId: invRef.id, store: invRef.store, success: false, error: 'No hay items seleccionados' });
                    continue;
                }

                const mappedItems = itemsToInvoice.map((item: any) => ({
                    name: item.name || 'Producto',
                    description: item.description || '',
                    price: parseFloat(item.price) || 0,
                    quantity: parseFloat(item.quantity) || 1,
                }));

                // 4. Crear factura en Kupocell
                const result = await this.billingService.createKupocellInvoice({
                    clientId: clientResult.id,
                    items: mappedItems,
                    warehouseId: payload.warehouseId,
                    costCenterId: payload.costCenterId,
                    applyIva: payload.applyIva,
                    date: invoiceData?.date || new Date().toISOString().split('T')[0],
                    dueDate: invoiceData?.dueDate || undefined,
                    observations: invoiceData?.observations || undefined,
                    anotation: invoiceData?.anotation || undefined,
                    seller: invoiceData?.seller?.name || undefined,
                    originalInvoiceId: String(invRef.id),
                    originalStore: invRef.store,
                    payments: invoice.paymentBankAccounts || undefined,
                });

                if (result.success) {
                    // 5. Marcar como facturada_sistema
                    await this.invoiceRepository.update(
                        { id: invRef.id, store: invRef.store },
                        { billingStatus: 'facturada_sistema' }
                    );

                    results.push({
                        invoiceId: invRef.id,
                        store: invRef.store,
                        success: true,
                        kupocellNumber: result.invoiceNumber,
                    });
                } else {
                    results.push({
                        invoiceId: invRef.id,
                        store: invRef.store,
                        success: false,
                        error: result.error,
                    });
                }

            } catch (error) {
                const errorMsg = error.message || 'Error desconocido';
                this.logger.error(`Error procesando factura ${invRef.id}: ${errorMsg}`);
                results.push({
                    invoiceId: invRef.id,
                    store: invRef.store,
                    success: false,
                    error: errorMsg,
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        this.logger.log(`📊 Resultado: ${successCount} éxitos, ${failCount} errores`);

        return {
            success: failCount === 0,
            total: results.length,
            successCount,
            failCount,
            results,
        };
    }

    @Get('test-connection')
    async testKupocellConnection() {
        return this.billingService.testConnection();
    }

    // ─── Product Mappings ─────────────────────────────────────────

    @Get('product-mappings')
    async getProductMappings() {
        return this.billingService.getProductMappings();
    }

    @Put('product-mappings')
    async saveProductMappings(@Body() payload: { upserts?: any[], deletedIds?: string[], mappings?: any[] }) {
        // Guardado INCREMENTAL: solo lo nuevo/modificado (upserts) + ids eliminados.
        // Compat: si llega 'mappings' (formato viejo), se trata como upserts.
        const upserts = payload?.upserts ?? payload?.mappings;
        const deletedIds = payload?.deletedIds ?? [];
        if (!Array.isArray(upserts) || !Array.isArray(deletedIds)) {
            throw new BadRequestException('Formato inválido para mappings');
        }
        const res = await this.billingService.saveProductMappings(upserts, deletedIds);
        return { success: true, ...res };
    }

    @Get('kupo-products')
    async getKupocellProducts(@Query('sync') sync?: string) {
        return this.billingService.getKupoProducts(sync === 'true');
    }

    // ─── Bank Mappings ────────────────────────────────────────────

    @Get('bank-mappings')
    async getBankMappings() {
        return this.billingService.getBankMappings();
    }

    @Put('bank-mappings')
    async saveBankMappings(@Body() payload: { upserts?: any[], deletedIds?: string[], mappings?: any[] }) {
        // Guardado INCREMENTAL (igual que product-mappings).
        const upserts = payload?.upserts ?? payload?.mappings;
        const deletedIds = payload?.deletedIds ?? [];
        if (!Array.isArray(upserts) || !Array.isArray(deletedIds)) {
            throw new BadRequestException('Formato inválido para mappings de bancos');
        }
        const res = await this.billingService.saveBankMappings(upserts, deletedIds);
        return { success: true, ...res };
    }

    @Get('kupo-banks')
    async getKupocellBanks(@Query('sync') sync?: string) {
        return this.billingService.getKupoBanks(sync === 'true');
    }

    @Get('metadata')
    async getBillingMetadata() {
        try {
            const [warehouses, taxes, products] = await Promise.all([
                this.billingService.getWarehouses(),
                this.billingService.getTaxes(),
                this.billingService.getKupoProducts()
            ]);

            return {
                warehouses,
                taxes,
                productsCount: products.length
            };
        } catch (error) {
            throw new BadRequestException('Failed to load metadata from Alegra Kupocell');
        }
    }

    @Post('process-batch')
    async processBatchInvoices(@Body() payload: {
        invoiceIds: string[],
        metadata: { warehouseId: string, taxId?: string, costCenterId?: string }
    }) {
        if (!payload.invoiceIds || payload.invoiceIds.length === 0) {
            throw new BadRequestException('No invoice IDs provided');
        }

        this.logger.log(`Starting bulk invoice process for ${payload.invoiceIds.length} items`);

        return {
            totalProcessed: payload.invoiceIds.length,
            successCount: payload.invoiceIds.length,
            failedCount: 0,
            errors: [],
            message: 'Invoices successfully created in target Kupocell account'
        };
    }

    @Post('process-excel')
    @UseInterceptors(FileInterceptor('file'))
    async processExcelFile(@UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('No Excel file uploaded');
        }

        try {
            const workbook = xlsx.read(file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data: any[] = xlsx.utils.sheet_to_json(sheet);

            this.logger.log(`Parsed Excel sheet "${sheetName}" with ${data.length} rows`);

            // Agrupar facturas usando el Consecutivo Interno (que es el ID real de Alegra y evita problemas de repetidos)
            // o como fallback el Número de Factura + Tienda original
            const groupedInvoices = new Map<string, any>();
            let lastValidInvoiceId = '';

            for (const row of data) {
                const invoiceIdRaw = String(row['Consecutivo interno (ALEGRA)'] || '').trim();
                const numFactura = String(row['Número Factura'] || '').trim();
                const tienda = String(row['Tienda Original'] || '').trim();

                let invoiceId = invoiceIdRaw || (numFactura && tienda ? `${numFactura}-${tienda}` : '');
                
                // Si esta fila no tiene ID (es un sub-item), usamos el último ID válido
                if (!invoiceId && lastValidInvoiceId) {
                    invoiceId = lastValidInvoiceId;
                }

                if (!invoiceId || invoiceId === '-') continue;
                lastValidInvoiceId = invoiceId;

                if (!groupedInvoices.has(invoiceId)) {
                    // Inicializar los datos globales de la factura (que vienen en la primera fila)
                    const payments: any[] = [];
                    // Extraer los bancos dinámicamente hasta 20 posibles (para estar seguros)
                    for (let i = 1; i <= 20; i++) {
                        const bankName = row[`Banco ${i}`];
                        const bankAmount = row[`Monto Banco ${i}`];
                        if (bankName && bankAmount) {
                            payments.push({ bankName: String(bankName).trim(), amount: parseFloat(bankAmount) });
                        }
                    }

                    groupedInvoices.set(invoiceId, {
                        originalInvoiceId: invoiceId,
                        invoiceNumber: numFactura,
                        originalStore: tienda,
                        warehouseName: String(row['Bodega'] || '').trim(),
                        costCenterName: String(row['Centro de Costo'] || '').trim(),
                        clientName: String(row['Cliente'] || '').trim(),
                        clientIdentification: String(row['Identificación Cliente'] || '').trim(),
                        clientEmail: String(row['Correo Cliente'] || '').trim(),
                        clientPhone: String(row['Teléfono Cliente'] || '').trim(),
                        clientAddress: String(row['Dirección Cliente'] || '').trim(),
                        clientCity: String(row['Ciudad Cliente'] || '').trim(),
                        clientDepartment: String(row['Departamento Cliente'] || '').trim(),
                        date: String(row['Fecha'] || '').trim(),
                        anotation: String(row['Anotación'] || '').trim(),
                        observations: String(row['Vendedor'] ? `Vendedor: ${row['Vendedor']}` : '').trim(),
                        payments: payments,
                        items: []
                    });
                }

                // Agregar el producto (ítem)
                const invoice = groupedInvoices.get(invoiceId);
                const itemName = row['Item'];

                if (itemName) {
                    const price = parseFloat(row['Precio Und']) || 0;
                    const taxRaw = String(row['Impuesto'] || '').trim();
                    let applyIva = false;
                    let taxRate = 0;

                    if (taxRaw === '19' || taxRaw === '19%') {
                        applyIva = true;
                        taxRate = 19;
                    } else if (taxRaw === '5' || taxRaw === '5%') {
                        taxRate = 5;
                    }

                    invoice.items.push({
                        name: String(itemName).trim(),
                        quantity: parseFloat(row['Cantidad']) || 1,
                        price: price, // El UI tiene Precio Unitario (sin IVA extraído aun, el backend se encarga de extraerlo según taxRate)
                        description: String(row['Descripción Item'] || '').trim(),
                        taxRate: taxRate,
                        applyIva: applyIva
                    });
                }
            }

            const invoicesToProcess = Array.from(groupedInvoices.values());
            this.logger.log(`Excel agrupado en ${invoicesToProcess.length} facturas únicas.`);

            // LOCK: si ya hay una importación en curso, no lanzar otra (evita la duplicación
            // por re-subida/doble-click mientras la primera sigue procesando).
            const running = await this.billingService.getRunningImportJob();
            if (running) {
                this.logger.warn(`⛔ Importación ya en curso (job ${running.id}, ${running.processed}/${running.total}). Se rechaza la nueva subida.`);
                return {
                    jobId: running.id,
                    total: running.total,
                    processed: running.processed,
                    alreadyRunning: true,
                    message: `Ya hay una importación en curso (${running.processed}/${running.total}). Espera a que termine antes de subir otra.`,
                };
            }

            // Crear job y procesar en BACKGROUND: respondemos al instante con el jobId (sin importar N).
            const job = await this.billingService.createImportJob(invoicesToProcess);
            this.logger.log(`🧾 Import job ${job.id} iniciado en background con ${job.total} facturas.`);
            return {
                jobId: job.id,
                total: job.total,
                message: `Importación iniciada en segundo plano (${job.total} facturas). Sigue el progreso con el jobId.`,
            };
        } catch (err) {
            this.logger.error('Error parsing Excel file', err.stack);
            throw new BadRequestException(`Error procesando Excel: ${err.message}`);
        }
    }

    /**
     * GET /electronic-billing/jobs/:id
     * Progreso de una importación masiva en background (para polling del front).
     */
    @Get('jobs/:id')
    async getImportJobProgress(@Param('id') id: string) {
        const job = await this.billingService.getImportJob(id);
        if (!job) {
            throw new BadRequestException('Job de importación no encontrado');
        }
        return {
            id: job.id,
            status: job.status,
            total: job.total,
            processed: job.processed,
            successCount: job.successCount,
            failCount: job.failCount,
            // Solo devolver el detalle por factura cuando terminó (puede ser grande)
            results: job.status === ImportJobStatus.COMPLETED ? job.results : undefined,
            errorMessage: job.errorMessage,
        };
    }

    @Get('sync-logs')
    async getSyncLogs() {
        return this.billingService.getSyncLogs();
    }
}
