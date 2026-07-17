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
import { Store } from './store.entity';

/**
 * Local cache of Alegra contacts (clients and providers) per store account.
 * Alegra exposes a single /contacts endpoint; `is_provider`/`is_client` classify the contact
 * (a contact can be both). `raw` keeps the full Alegra payload so nothing is lost.
 */
@Entity('contacts')
@Index('UQ_contact_store_alegra_id', ['store_key', 'alegra_id'], { unique: true })
export class Contact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Store (sede) this contact belongs to. */
  @Index()
  @ManyToOne(() => Store, { nullable: true })
  @JoinColumn({ name: 'store_id' })
  store: Store | null;

  /** Store key used to reach the Alegra account (kept for fetch context + fast filtering). */
  @Index()
  @Column({ type: 'varchar', length: 50 })
  store_key: string;

  /** Alegra contact id. */
  @Column({ type: 'varchar', length: 50 })
  alegra_id: string;

  @Column({ type: 'varchar', length: 300 })
  name: string;

  @Index()
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  identification: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  email: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  phone: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  mobile: string | null;

  // ── Type (client / provider) — a contact can be both ──────────────────────
  @Column({ type: 'boolean', default: false })
  is_provider: boolean;

  @Column({ type: 'boolean', default: false })
  is_client: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true, default: null })
  status: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  /** Alegra address object { address, city, department, country, zipCode }. */
  @Column({ type: 'jsonb', nullable: true, default: null })
  address: Record<string, any> | null;

  /** Complete Alegra contact payload — nothing is dropped. */
  @Column({ type: 'jsonb', nullable: true, default: null })
  raw: Record<string, any> | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
