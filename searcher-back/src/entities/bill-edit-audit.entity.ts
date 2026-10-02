import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export interface BillFieldChange {
  field: string;
  label: string;
  before: any;
  after: any;
}

/**
 * Registro de TODA edición de una factura de compra hecha desde la plataforma,
 * con o sin caso de Google Chat detrás. Es el histórico que pidió el negocio.
 */
@Entity('bill_edit_audits')
@Index(['store', 'billId'])
export class BillEditAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  store: string;

  @Column()
  billId: string;

  @Column({ type: 'varchar', nullable: true })
  billNumber: string | null;

  // ─── Quién ────────────────────────────────────────────────────────────

  @Column({ type: 'int', nullable: true })
  userId: number | null;

  @Column()
  username: string;

  @Column()
  userRole: string;

  // ─── Qué cambió ───────────────────────────────────────────────────────

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  changes: BillFieldChange[];

  // ─── Trazabilidad con Google Chat ─────────────────────────────────────

  /** Caso que autorizó la edición; null si la hizo admin/compras sin caso */
  @Column({ type: 'uuid', nullable: true })
  caseId: string | null;

  @Column({ type: 'varchar', nullable: true })
  threadName: string | null;

  /** Si se logró publicar el resumen en el hilo de Chat */
  @Column({ type: 'boolean', default: false })
  chatNotified: boolean;

  @Column({ type: 'text', nullable: true })
  chatError: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
