import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum SyncStatus {
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED',
    PENDING = 'PENDING'
}

// Índice (NO único) para acelerar la verificación de idempotencia por originalInvoiceId.
// No se usa UNIQUE porque la columna ya tiene duplicados históricos (FAILED+SUCCESS y
// duplicados del bug previo) y synchronize:true fallaría al crear el índice único.
@Entity('invoice_sync_log')
@Index(['originalInvoiceId'])
export class InvoiceSyncLog {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    // Formato: idOriginal_sede (ej. '150_armenia')
    @Column()
    originalInvoiceId: string;

    // ID generado por Kupocell en Alegra
    @Column({ nullable: true })
    kupoInvoiceId: string;

    @Column({
        type: 'enum',
        enum: SyncStatus,
        default: SyncStatus.PENDING
    })
    status: SyncStatus;

    // Guardar mensaje de error si existió para reportería
    @Column({ type: 'text', nullable: true })
    errorMessage: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
