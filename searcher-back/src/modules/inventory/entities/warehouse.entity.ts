import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Store } from './store.entity';

@Entity('warehouses')
export class Warehouse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Store, (s) => s.warehouses, { nullable: false })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'boolean', default: false })
  is_main: boolean;

  /**
   * Name prefix for Alegra items tied to this warehouse (e.g. "(P)" for Bodega Pereira).
   * Main warehouses carry no prefix. Null/empty = item name goes unprefixed.
   */
  @Column({ type: 'varchar', length: 20, nullable: true, default: null })
  prefix: string | null;

  @Column({ type: 'integer', nullable: true, default: null })
  alegra_warehouse_id: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  alegra_store_key: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
