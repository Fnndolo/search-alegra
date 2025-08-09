import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('invoices')
@Index(['store', 'datetime'])
export class Invoice {
  @PrimaryColumn()
  id: number;

  @PrimaryColumn()
  store: string;

  @Column('jsonb')
  data: any; // Almacena toda la data de la factura como JSON

  @Column({ type: 'timestamp', nullable: true })
  datetime: Date | null;

  @Column({ type: 'date', nullable: true })
  date: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
