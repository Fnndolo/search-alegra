import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Reason a line of an Alegra invoice could not be automatically discounted from inventory.
 * See `InventoryStockService.discountInvoiceItem` / `discountFungibleSale`.
 */
export type SaleSyncIssueReason =
  | 'NO_MAPPING'
  | 'NO_IMEI_MATCH'
  | 'PARTIAL_MATCH'
  | 'MULTI_VARIANT_FUNGIBLE'
  | 'NO_VARIANTS';

/**
 * Persisted record of an invoice line that `InventoryStockService.processInvoiceSale` could not
 * fully resolve automatically (no Alegra→product mapping, no/partial IMEI match against
 * observations, a fungible product with more than one color variant, or a serialized product with
 * no variants at all). One row per problematic `(store_key, alegra_invoice_id, alegra_item_id)`
 * line — retrying `processInvoiceSale` with fresh Alegra data upserts the same row and marks it
 * `resolved` if the retry succeeds, instead of creating a new row every attempt.
 */
@Entity('sale_sync_issues')
@Index('UQ_sale_sync_issue_line', ['store_key', 'alegra_invoice_id', 'alegra_item_id'], {
  unique: true,
})
export class SaleSyncIssue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_key', type: 'varchar', length: 50 })
  store_key: string;

  @Index()
  @Column({ name: 'alegra_invoice_id', type: 'varchar', length: 100 })
  alegra_invoice_id: string;

  @Column({ name: 'alegra_item_id', type: 'integer' })
  alegra_item_id: number;

  @Column({ name: 'reason', type: 'varchar', length: 30 })
  reason: SaleSyncIssueReason;

  @Column({ name: 'details', type: 'text', nullable: true, default: null })
  details: string | null;

  @Column({ name: 'quantity_expected', type: 'integer' })
  quantity_expected: number;

  @Column({ name: 'quantity_resolved', type: 'integer', default: 0 })
  quantity_resolved: number;

  @Column({ name: 'resolved', type: 'boolean', default: false })
  resolved: boolean;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
}
