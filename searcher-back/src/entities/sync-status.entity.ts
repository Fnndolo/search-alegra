import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('sync_status')
@Index(['store', 'type'], { unique: true })
export class SyncStatus {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  store: string;

  @Column()
  type: 'invoices' | 'bills';

  @Column({ type: 'timestamp', nullable: true })
  lastSyncDatetime: Date | null;

  @Column({ default: 0 })
  totalRecords: number;

  @Column({ default: false })
  isFullyLoaded: boolean;

  @Column({ default: false })
  isSyncing: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
