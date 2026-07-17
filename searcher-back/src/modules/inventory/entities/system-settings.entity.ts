import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('system_settings')
export class SystemSettings {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
