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
import { Warehouse } from './warehouse.entity';

/**
 * Raw cache of Alegra items ("products"), one row per (store, alegra item), refreshed by
 * `AlegraImportService.syncAlegraProductCache`. This is intentionally dumb storage — no business
 * logic reads `reference`; it's only kept around in case someone needs to eyeball what Alegra
 * calls that item's SKU/reference manually. Local SKU always lives in `ProductVariant.sku`,
 * completely independent from this field.
 */
@Entity('alegra_product_cache')
@Index('UQ_alegra_product_cache_store_item', ['store_key', 'alegra_item_id'], { unique: true })
export class AlegraProductCache {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  store_key: string;

  @Column({ type: 'integer' })
  alegra_item_id: number;

  @Column({ type: 'varchar', length: 320 })
  name: string;

  /**
   * Alegra's "reference" field. NOT used for any business logic — never synced with
   * `ProductVariant.sku`. Purely cached for manual inspection.
   */
  @Column({ type: 'varchar', length: 150, nullable: true, default: null })
  reference: string | null;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    default: null,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v == null ? null : Number(v)),
    },
  })
  price: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true, default: null })
  status: string | null;

  /** Full raw Alegra item payload, kept in case something we don't map today is needed later. */
  @Column({ type: 'jsonb', nullable: true, default: null })
  raw: Record<string, any> | null;

  /**
   * Alegra's own warehouse id for this item, taken from `raw.inventory.warehouses[0].id`
   * (one Alegra item = one warehouse, per the prefix-per-warehouse convention). Resolved at
   * sync time in `AlegraImportService.syncAlegraProductCache`.
   */
  @Column({ type: 'integer', nullable: true, default: null })
  alegra_warehouse_id: number | null;

  /** Local `Warehouse` matched from `alegra_warehouse_id` for this store, resolved at sync time. */
  @Column({ type: 'uuid', nullable: true, default: null })
  warehouse_id: string | null;

  @ManyToOne(() => Warehouse, { nullable: true })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse | null;

  @Column({ type: 'timestamp' })
  synced_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
