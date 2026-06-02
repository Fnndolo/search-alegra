import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum ImportJobStatus {
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
}

/**
 * Representa una importación masiva de facturas desde Excel ejecutándose en segundo plano.
 * Permite responder al usuario al instante (devolviendo el jobId) y consultar el progreso
 * por polling, además de reanudar tras un reinicio de Railway (gracias a la idempotencia
 * del invoice_sync_log, reprocesar es seguro: las ya creadas se saltan).
 */
@Entity('billing_import_jobs')
export class BillingImportJob {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({
        type: 'enum',
        enum: ImportJobStatus,
        default: ImportJobStatus.PROCESSING,
    })
    status: ImportJobStatus;

    @Column({ default: 0 })
    total: number;

    @Column({ default: 0 })
    processed: number;

    @Column({ default: 0 })
    successCount: number;

    @Column({ default: 0 })
    failCount: number;

    // Facturas agrupadas pendientes de procesar (snapshot para poder reanudar tras un restart).
    @Column({ type: 'jsonb', nullable: true })
    invoices: any;

    // Resultado por factura (mismo shape que devolvía processMassExcelInvoices).
    @Column({ type: 'jsonb', nullable: true })
    results: any;

    @Column({ type: 'text', nullable: true })
    errorMessage: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
