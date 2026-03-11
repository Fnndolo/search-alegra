import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('invoices')
@Index(['store', 'datetime'])
@Index(['billingStatus'])
export class Invoice {
  @PrimaryColumn()
  id: number;

  @PrimaryColumn()
  store: string;

  @Column('jsonb')
  data: any;

  @Column({ type: 'timestamp', nullable: true })
  datetime: Date | null;

  @Column({ type: 'date', nullable: true })
  date: Date | null;

  @Column({ type: 'varchar', nullable: true })
  bankAccountName: string | null;

  // null = factura antigua (no rastreada), 'pendiente' = nueva sin facturar, 'facturada' = ya facturada
  @Column({ type: 'varchar', nullable: true, default: null })
  billingStatus: string | null;

  // null = todos los items seleccionados, array de IDs = solo esos items están seleccionados
  @Column({ type: 'jsonb', nullable: true, default: null })
  selectedItemIds: string[] | null;

  // Array de bancos/cuentas de pago: [{ paymentId, bankName, amount }]
  // null = no se han cargado aún
  @Column({ type: 'jsonb', nullable: true, default: null })
  paymentBankAccounts: { paymentId: string, bankName: string, amount: number }[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
