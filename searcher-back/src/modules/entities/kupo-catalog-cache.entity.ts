import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('kupo_catalog_cache')
export class KupoCatalogCache {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    type: string; // 'products' | 'banks'

    @Column({ type: 'jsonb' })
    data: any;

    @UpdateDateColumn()
    updatedAt: Date;
}
