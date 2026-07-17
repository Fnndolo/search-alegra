import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { PurchaseOrder } from './purchase-order.entity';

export type PurchaseOrderAction =
  | 'created'
  | 'draft_created'
  | 'draft_updated'
  | 'submitted'
  | 'edited'
  | 'cancelled'
  | 'inventory_synced'
  | 'serial_conflict'
  | 'retry_inventory'
  | 'alegra_status_updated';

@Entity('purchase_order_history')
export class PurchaseOrderHistory {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Index()
  @ManyToOne(() => PurchaseOrder, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'purchase_order_id' })
  purchase_order: PurchaseOrder;

  @Column({ type: 'bigint' })
  purchase_order_id: number;

  @Column({ type: 'varchar', length: 50 })
  action: PurchaseOrderAction;

  @Column({ type: 'jsonb', nullable: true, default: null })
  detail: Record<string, any> | null;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  created_by: string | null;

  @CreateDateColumn()
  created_at: Date;
}
