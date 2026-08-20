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
import { Warehouse } from './warehouse.entity';
import { Store } from './store.entity';

export type PurchaseOrderStatus = 'draft' | 'active' | 'serial_duplicated' | 'cancelled';
export type PurchaseOrderAlegraStatus = 'not_sync' | 'sync' | 'closed' | 'void';

export interface PurchaseOrderUnit {
  identifier: string | null;
}

export interface PurchaseOrderItem {
  alegraItemId: number;
  /** Producto local — permite resolver/crear el item en Alegra si `alegraItemId` todavía no existe. */
  productId?: string | null;
  /** ProductVariant (color+sku) explícita elegida en el form; null/undefined = usar el fallback
   *  documentado en purchase-orders.service.ts (resolveProductVariant). */
  productVariantId?: string | null;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
  requiresSerial: boolean;
  units: PurchaseOrderUnit[];
}

@Index(['store', 'alegra_id'], { unique: true })
@Entity('purchase_orders')
export class PurchaseOrder {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  /** Store key (e.g. "pereira") — still the key used for Alegra client resolution. */
  @Index()
  @Column({ type: 'varchar', length: 50 })
  store: string;

  /** Real FK counterpart of `store`, resolved at write time — mirrors `warehouse_local` below. */
  @ManyToOne(() => Store, { nullable: true })
  @JoinColumn({ name: 'store_id' })
  store_local: Store | null;

  @Column({ type: 'integer', nullable: true, default: null })
  alegra_id: number | null;

  @Column({ type: 'varchar', length: 20, default: 'not_sync' })
  alegra_status: PurchaseOrderAlegraStatus;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status: PurchaseOrderStatus;

  @Column({ type: 'varchar', length: 30, nullable: true, default: null })
  alegra_bill_number: string | null;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'date' })
  due_date: string;

  @Column({ type: 'jsonb' })
  provider: { id: number; name: string; identification?: string };

  @Column({ type: 'jsonb' })
  warehouse: { id: string; name: string };

  @ManyToOne(() => Warehouse, { nullable: true })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse_local: Warehouse | null;

  @Column({ type: 'text', nullable: true, default: null })
  observations: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, default: null })
  total: number | null;

  @Column({ type: 'jsonb' })
  items: PurchaseOrderItem[];

  @Column({ type: 'boolean', default: false })
  inventory_synced: boolean;

  @Column({ type: 'text', nullable: true, default: null })
  inventory_error: string | null;

  @Column({ type: 'jsonb', nullable: true, default: null })
  alegra_data: Record<string, any> | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
