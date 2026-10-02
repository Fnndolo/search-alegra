import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum BillEditCaseStatus {
  /** Caso abierto: habilita UNA edición de esa factura de compra */
  OPEN = 'open',
  /** Ya se usó para editar: no habilita más ediciones hasta que se abra otro caso */
  USED = 'used',
  /** El mensaje no se pudo resolver a una factura real (sede o número inválidos) */
  INVALID = 'invalid',
}

/**
 * Caso abierto desde Google Chat que autoriza al rol `inventario_compras` a editar
 * UNA factura de compra concreta. Cada hilo del espacio equivale a un caso.
 */
@Entity('bill_edit_cases')
@Index(['store', 'billId', 'status'])
@Index(['threadName'])
export class BillEditCase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  store: string;

  /** Número tal como lo escribieron en el chat */
  @Column()
  billNumber: string;

  /** ID de la factura en Alegra, resuelto a partir de sede + número */
  @Column({ type: 'varchar', nullable: true })
  billId: string | null;

  // ─── Origen en Google Chat ────────────────────────────────────────────

  /** Recurso del espacio, p.ej. `spaces/AAAA` */
  @Column()
  spaceName: string;

  /** Recurso del hilo, p.ej. `spaces/AAAA/threads/BBBB`. Identifica el caso. */
  @Column()
  threadName: string;

  /** Nombre visible de quien abrió el caso en Chat */
  @Column({ type: 'varchar', nullable: true })
  openedByChatUser: string | null;

  /** Texto original del mensaje que abrió el caso (para auditoría) */
  @Column({ type: 'text', nullable: true })
  openingMessage: string | null;

  // ─── Estado ───────────────────────────────────────────────────────────

  @Column({ type: 'enum', enum: BillEditCaseStatus, default: BillEditCaseStatus.OPEN })
  status: BillEditCaseStatus;

  @Column({ type: 'timestamp', nullable: true })
  usedAt: Date | null;

  /** Usuario de la plataforma que consumió el caso */
  @Column({ type: 'int', nullable: true })
  usedByUserId: number | null;

  @Column({ type: 'varchar', nullable: true })
  usedByUsername: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
