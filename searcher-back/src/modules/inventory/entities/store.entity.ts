import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { Warehouse } from './warehouse.entity';

@Entity('stores')
export class Store {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Index()
  @Column({ type: 'varchar', length: 50, unique: true })
  store_key: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'varchar', length: 10, nullable: true, default: null })
  alegra_sync_override: 'auto' | 'manual' | null;

  @OneToMany(() => Warehouse, (w) => w.store)
  warehouses: Warehouse[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
