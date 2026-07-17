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
import { Product } from './product.entity';
import { Warehouse } from './warehouse.entity';

/**
 * Maps a local product to the Alegra item created for a SPECIFIC WAREHOUSE (bodega).
 * One local product → one Alegra item per warehouse, named with the warehouse prefix
 * (e.g. "(P) iPhone 17 Pro Max" for Bodega Pereira; main warehouses carry no prefix).
 * A product is "created in Alegra" for a warehouse when a row exists here.
 * NOTE: separate from the legacy `product_alegra_items` (per-store mapping), which stays untouched.
 */
@Entity('product_warehouse_alegra_item')
@Index('UQ_pwai_product_warehouse', ['product_id', 'warehouse_id'], { unique: true })
@Index('UQ_pwai_store_alegra_item', ['store_key', 'alegra_item_id'], { unique: true })
export class ProductWarehouseAlegraItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  product_id: string;

  @ManyToOne(() => Product, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'uuid' })
  warehouse_id: string;

  @ManyToOne(() => Warehouse, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  /** Store key of the warehouse's sede (denormalized for fast lookups from purchase orders). */
  @Index()
  @Column({ type: 'varchar', length: 50 })
  store_key: string;

  /** Item id returned by Alegra when the item was created (or adopted by name match). */
  @Column({ type: 'integer' })
  alegra_item_id: number;

  /** Exact name the item carries in Alegra (prefix + product name) — for traceability. */
  @Column({ type: 'varchar', length: 320, nullable: true, default: null })
  alegra_name: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
