import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Variant } from './variant.entity';
import { ProductVariant } from './product-variant.entity';
import { Warehouse } from './warehouse.entity';
import { Store } from './store.entity';
import { MovementType } from './enums';

@Entity('inventory_movements')
export class InventoryMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // nullable: fungible product variants (has_identifier = false) link to product_variant directly, not variant
  @ManyToOne(() => Variant, { nullable: true })
  @JoinColumn({ name: 'variant_id' })
  variant: Variant | null;

  // Direct product-variant reference for fungible items tracked by cantidad (variant will be null in those rows)
  @Index()
  @ManyToOne(() => ProductVariant, { nullable: true })
  @JoinColumn({ name: 'product_variant_id' })
  product_variant: ProductVariant | null;

  @Column({ type: 'enum', enum: MovementType })
  movement_type: MovementType;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  reference: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  observation: string | null;

  @Column({ type: 'timestamp' })
  movement_date: Date;

  @Column({ type: 'uuid', nullable: true, default: null })
  user_id: string | null;

  @ManyToOne(() => Warehouse, { nullable: true })
  @JoinColumn({ name: 'origin_warehouse_id' })
  origin_warehouse: Warehouse | null;

  @ManyToOne(() => Warehouse, { nullable: true })
  @JoinColumn({ name: 'destination_warehouse_id' })
  destination_warehouse: Warehouse | null;

  @ManyToOne(() => Store, { nullable: false })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Index()
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  alegra_invoice_id: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
