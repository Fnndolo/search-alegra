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
import { AlegraProductCache } from './alegra-product-cache.entity';
import { Category } from './category.entity';
import { Product } from './product.entity';

export type ProductImportDraftStatus = 'pending' | 'configured' | 'imported';

export interface DraftVariantInput {
  color: string;
  sku: string;
}

/**
 * Editable draft for turning an `AlegraProductCache` row into a local `Product` +
 * its `ProductVariant`(s). One draft per cache item. `suggested_sku` is copied from Alegra's
 * `reference` purely as a starting suggestion for the operator to edit — it is NOT trusted as
 * the final SKU and is never treated as authoritative business data.
 */
@Entity('product_import_draft')
export class ProductImportDraft {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('UQ_pid_alegra_product_cache', { unique: true })
  @Column({ type: 'uuid' })
  alegra_product_cache_id: string;

  @ManyToOne(() => AlegraProductCache, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'alegra_product_cache_id' })
  alegra_product_cache: AlegraProductCache;

  /** Denormalized from the cache row, for fast filtering by sede. */
  @Index()
  @Column({ type: 'varchar', length: 50 })
  store_key: string;

  @Column({ type: 'varchar', length: 320 })
  suggested_name: string;

  @Column({ type: 'varchar', length: 150, nullable: true, default: null })
  suggested_sku: string | null;

  @Column({ type: 'uuid', nullable: true, default: null })
  category_id: string | null;

  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category: Category | null;

  /**
   * Configured alongside category_id via PATCH, kept here so `/import` has everything it needs.
   * Same shape as the "create product" flow: one or more {color, sku} pairs, no price per variant
   * (price lives on the product, see `sale_price`).
   */
  @Column({ type: 'jsonb', nullable: true, default: null })
  variants: DraftVariantInput[] | null;

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
  sale_price: number | null;

  @Column({ type: 'boolean', nullable: true, default: null })
  has_identifier: boolean | null;

  @Column({ type: 'boolean', nullable: true, default: null })
  negative_sell: boolean | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: ProductImportDraftStatus;

  @Column({ type: 'uuid', nullable: true, default: null })
  product_id: string | null;

  @ManyToOne(() => Product, { nullable: true })
  @JoinColumn({ name: 'product_id' })
  product: Product | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
